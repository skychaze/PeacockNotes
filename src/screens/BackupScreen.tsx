import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../components/AppText';
import { BackupProgressCard } from '../components/BackupProgressCard';
import { BackupTestingNotice } from '../components/BackupTestingNotice';
import { Card } from '../components/Card';
import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { PressableScale } from '../components/PressableScale';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { TOP_BAR_HEIGHT, TopBar } from '../components/TopBar';
import { useLanguage } from '../i18n/LanguageContext';
import {
  chooseBackupFolder,
  disconnectBackupFolder,
  releaseBackupForegroundService,
  startBackupForegroundService,
} from '../services/backupFolder';
import {
  exportBackup,
  clearLastVerifiedBackupIfDeleted,
  getManagedRetentionState,
  getLastVerifiedBackup,
  type ExportProgress,
  type ManagedRetentionState,
  type VerifiedBackup,
} from '../services/backupExport';
import { getActiveBackupOperation } from '../services/backupBackground';
import { requestBackupNotificationPermissionOnce } from '../services/backupNotificationPermission';
import {
  attemptAutomaticBackup,
  getAutomaticBackupState,
  setAutomaticBackupInterval,
  setAutomaticBackupEnabled,
  setAutomaticBackupAuthorizationInProgress,
  type AutomaticBackupState,
} from '../services/automaticBackup';
import { loadFullReplacementUndo, undoFullReplacement } from '../services/backupImport';
import {
  type BackupCollectionArchive,
  type FullReplacementUndo,
  deleteBackupArchives,
} from '../services/archive';
import {
  getBackupDiscoverySnapshot,
  initializeBackupDiscovery,
  removeBackupDiscoveryArchives,
  refreshBackupDiscovery,
  subscribeBackupDiscovery,
} from '../services/backupDiscovery';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { RootStackParamList } from '../types/navigation';
import { formatBackupDate } from '../utils/backupDate';
import { getBackupProgressSnapshot, subscribeBackupProgress, type BackupProgressSnapshot } from '../services/backupProgress';
import { AUTOMATIC_BACKUP_INTERVAL_HOURS, DEFAULT_AUTOMATIC_BACKUP_INTERVAL_HOURS, type AutomaticBackupIntervalHours } from '../backup/automaticPolicy';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'Backup'>;

export const BackupScreen = () => {
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const { colors } = useAppColors();
  const { language, t } = useLanguage();
  const [liveProgress, setLiveProgress] = useState<BackupProgressSnapshot | null>(null);
  const [discovery, setDiscovery] = useState(getBackupDiscoverySnapshot());
  const [isChoosing, setIsChoosing] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [verifiedBackup, setVerifiedBackup] = useState<VerifiedBackup | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [undo, setUndo] = useState<FullReplacementUndo | null>(null);
  const [undoState, setUndoState] = useState<'idle' | 'loading' | 'committing'>('loading');
  const [undoMessage, setUndoMessage] = useState<'success' | 'failed' | null>(null);
  const [automatic, setAutomatic] = useState<AutomaticBackupState | null>(null);
  const [isChangingAutomatic, setIsChangingAutomatic] = useState(false);
  const [retention, setRetention] = useState<ManagedRetentionState | null>(null);
  const [activeOperation, setActiveOperation] = useState<Awaited<ReturnType<typeof getActiveBackupOperation>> | null>(null);
  const [operationRunning, setOperationRunning] = useState(false);
  const [selectedArchiveUris, setSelectedArchiveUris] = useState<ReadonlySet<string>>(new Set());
  const [isDeletingArchives, setIsDeletingArchives] = useState(false);
  const mountedRef = useRef(true);
  const operationStatusPollInFlightRef = useRef(false);
  const foregroundOperationInFlightRef = useRef(false);
  const automaticChangeInFlightRef = useRef(false);
  const chooseInFlightRef = useRef(false);

  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => subscribeBackupDiscovery(setDiscovery), []);

  useFocusEffect(useCallback(() => {
    let active = true;
    let revision = 0;
    const unsubscribe = subscribeBackupProgress((snapshot) => {
      revision += 1;
      if (active) setLiveProgress(snapshot?.state === 'running' ? snapshot : null);
    });
    const refresh = async () => {
      const startedAt = revision;
      try {
        const snapshot = await getBackupProgressSnapshot();
        if (active && revision === startedAt) setLiveProgress(snapshot?.state === 'running' ? snapshot : null);
      } catch (error) {
        console.warn('Failed to read backup progress:', error);
      }
    };
    void refresh();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => { active = false; unsubscribe(); appState.remove(); };
  }, []));

  const folder = discovery.value.folder;
  const collection = discovery.value.collection;
  const isLoading = discovery.phase === 'idle' || (discovery.phase === 'loading' && discovery.updatedAt === null);
  const scanState: 'idle' | 'loading' | 'failed' = discovery.phase === 'loading'
    ? 'loading'
    : discovery.phase === 'failed' || discovery.value.scanError !== null
      ? 'failed'
      : 'idle';

  const runForegroundOperation = async <T,>(work: () => Promise<T>): Promise<T> => {
    // React state updates are asynchronous, so two rapid taps can otherwise
    // both pass the `operationBusy` check before the first durable row exists.
    // Claim the in-process slot synchronously and release it in the same
    // finally block as the foreground-service lease.
    if (foregroundOperationInFlightRef.current) throw new Error('BACKUP_OPERATION_BUSY');
    foregroundOperationInFlightRef.current = true;
    setOperationRunning(true);
    let completed = false;
    let serviceStarted = false;
    try {
      const activeBeforeStart = await getActiveBackupOperation();
      if (activeBeforeStart) throw new Error('BACKUP_OPERATION_BUSY');
      await requestBackupNotificationPermissionOnce();
      await startBackupForegroundService();
      serviceStarted = true;
      const result = await work();
      completed = true;
      return result;
    } finally {
      // Notification/service cleanup is best-effort. A provider operation can
      // already have committed, and a cleanup exception must never turn that
      // success into a stuck/busy screen or mask the original error.
      if (serviceStarted) {
        try {
          await releaseBackupForegroundService(completed);
        } catch (error) {
          console.warn('Failed to release backup foreground service:', error);
        }
      }
      if (mountedRef.current) setOperationRunning(false);
      // The durable operation may have completed while this screen was not
      // focused. Re-read it so a screen that stayed mounted does not keep its
      // controls disabled until the next navigation event.
      void loadOperationStatus();
      foregroundOperationInFlightRef.current = false;
    }
  };

  const loadRetention = useCallback(async () => {
    try {
      const value = await getManagedRetentionState();
      if (mountedRef.current) setRetention(value);
    } catch (error) {
      console.warn('Failed to read managed retention state:', error);
    }
  }, []);

  const loadOperationStatus = useCallback(async () => {
    try {
      const [active, lastVerified] = await Promise.all([
        getActiveBackupOperation(),
        getLastVerifiedBackup(),
      ]);
      if (!mountedRef.current) return;
      setActiveOperation(active);
      if (!active) {
        // Do not resurrect the previous success banner while a new export is
        // active. The persisted record becomes authoritative again once the
        // durable operation reaches a terminal state.
        setVerifiedBackup(lastVerified);
        setExportProgress(null);
      } else if (active.kind === 'export' || active.kind === 'automatic_backup') {
        setVerifiedBackup(null);
        // Keep the live callback stage when this screen is already observing
        // the operation; synthesize a stage only when attaching after a
        // navigation/process change.
        setExportProgress((current) => current ?? 'publishing');
      } else if (active.kind === 'import') {
        setExportProgress(null);
      } else {
        setExportProgress(null);
      }
    } catch (error) {
      console.warn('Failed to restore backup operation status:', error);
    }
  }, []);

  const loadAutomatic = useCallback(async () => {
    try {
      const value = await getAutomaticBackupState();
      if (mountedRef.current) setAutomatic(value);
    } catch (error) {
      console.warn('Failed to read Automatic backup state:', error);
    }
  }, []);

  const loadUndo = useCallback(async () => {
    setUndoState('loading');
    try {
      const value = await loadFullReplacementUndo();
      if (mountedRef.current) setUndo(value);
    } catch (error) {
      console.warn('Failed to inspect full replacement undo:', error);
      if (mountedRef.current) setUndo({ state: 'unavailable', snapshotId: null, expiresAt: null });
    } finally {
      if (mountedRef.current) setUndoState('idle');
    }
  }, []);

  const scanCollection = useCallback(async () => {
    try {
      await refreshBackupDiscovery();
    } catch (error) {
      console.warn('Failed to scan backup collection:', error);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void initializeBackupDiscovery();
      void loadUndo();
      void loadAutomatic();
      void loadRetention();
      void loadOperationStatus();
    }, [loadAutomatic, loadOperationStatus, loadRetention, loadUndo])
  );

  const changeAutomatic = async (enabled: boolean) => {
    if (automaticChangeInFlightRef.current || operationBusy) return;
    automaticChangeInFlightRef.current = true;
    setIsChangingAutomatic(true);
    try {
      const next = await setAutomaticBackupEnabled(
        enabled,
        automatic?.intervalHours ?? DEFAULT_AUTOMATIC_BACKUP_INTERVAL_HOURS,
      );
      setAutomatic(next);
      if (enabled) setAutomatic(await attemptAutomaticBackup());
    } catch (error) {
      console.warn('Failed to change Automatic backup:', error);
      Alert.alert(t('common.error'), t('backup.automatic.changeError'));
      await loadAutomatic();
    } finally {
      setIsChangingAutomatic(false);
      automaticChangeInFlightRef.current = false;
    }
  };

  const changeAutomaticInterval = async (intervalHours: AutomaticBackupIntervalHours) => {
    if (automaticChangeInFlightRef.current || operationBusy || !automatic || automatic.intervalHours === intervalHours) return;
    automaticChangeInFlightRef.current = true;
    setIsChangingAutomatic(true);
    try {
      setAutomatic(await setAutomaticBackupInterval(intervalHours));
    } catch (error) {
      console.warn('Failed to change Automatic backup interval:', error);
      Alert.alert(t('common.error'), t('backup.automatic.changeError'));
      await loadAutomatic();
    } finally {
      setIsChangingAutomatic(false);
      automaticChangeInFlightRef.current = false;
    }
  };

  const chooseFolder = async () => {
    if (chooseInFlightRef.current || isChoosing || operationBusy) return;
    chooseInFlightRef.current = true;
    try {
      setIsChoosing(true);
      setAutomaticBackupAuthorizationInProgress(true);
      await chooseBackupFolder();
      await refreshBackupDiscovery();
    } catch (error) {
      if ((error as { code?: string }).code === 'PICKER_CANCELLED') return;
      console.warn('Failed to choose backup folder:', error);
      Alert.alert(t('common.error'), t('backup.chooseError'));
    } finally {
      setAutomaticBackupAuthorizationInProgress(false);
      setIsChoosing(false);
      chooseInFlightRef.current = false;
    }
  };

  const toggleSelectedArchive = (uri: string) => {
    setSelectedArchiveUris((current) => {
      const next = new Set(current);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });
  };

  const confirmDeleteArchives = () => {
    if (selectedArchiveUris.size === 0 || isDeletingArchives || operationBusy) return;
    const uris = [...selectedArchiveUris];
    Alert.alert(
      t('backup.collection.deleteConfirmTitle'),
      t('backup.collection.deleteConfirmBody', { count: uris.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            if (foregroundOperationInFlightRef.current || operationBusy) return;
            foregroundOperationInFlightRef.current = true;
            setIsDeletingArchives(true);
            setOperationRunning(true);
            try {
              const active = await getActiveBackupOperation();
              if (active) throw new Error('BACKUP_OPERATION_BUSY');
              await deleteBackupArchives(uris);
              await clearLastVerifiedBackupIfDeleted(uris);
              setVerifiedBackup((current) => current && uris.includes(current.uri) ? null : current);
              // Evict by immutable Drive ID before refreshing. Drive listings
              // can briefly be eventually consistent after DELETE.
              removeBackupDiscoveryArchives(uris);
              setSelectedArchiveUris(new Set());
              void refreshBackupDiscovery()
                .then(() => removeBackupDiscoveryArchives(uris))
                .catch((error: unknown) => console.warn('Failed to refresh backups after deletion:', error));
            } catch (error) {
              console.warn('Failed to delete backup archives:', error);
              Alert.alert(t('common.error'), t('backup.collection.deleteError'));
              // A provider can delete an earlier item before a later item
              // fails. Reconcile the cache even on this partial-failure path.
              void refreshBackupDiscovery().catch((refreshError: unknown) => {
                console.warn('Failed to reconcile backups after deletion error:', refreshError);
              });
            } finally {
              if (mountedRef.current) {
                setIsDeletingArchives(false);
                setOperationRunning(false);
              }
              foregroundOperationInFlightRef.current = false;
            }
          },
        },
      ],
    );
  };

  const startExport = async () => {
    setExportError(null);
    setVerifiedBackup(null);
    try {
      const result = await runForegroundOperation(() => exportBackup((progress) => {
        setExportProgress(progress);
      }));
      setVerifiedBackup(result);
      // A collection scan re-downloads and validates every archive. Refresh it
      // after the verified result is visible instead of holding the export UI
      // at 92% while that non-critical work completes.
      void loadRetention();
      void refreshBackupDiscovery();
    } catch (error: unknown) {
      console.warn('Backup export failed:', error);
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : error instanceof Error ? error.message : 'EXPORT_FAILED';
      const known = [
        'INSUFFICIENT_STORAGE', 'DESTINATION_STORAGE_INSUFFICIENT', 'PROVIDER_INTERRUPTED',
        'PARTIAL_WRITE', 'PARTIAL_OUTPUT_REMAINS', 'OUTPUT_RENAMED', 'STAGING_MISSING',
        'DESTINATION_VERIFICATION_FAILED', 'DRIVE_AUTH_REQUIRED', 'DRIVE_API_FORBIDDEN',
        'DRIVE_RATE_LIMITED', 'DRIVE_UNAVAILABLE', 'DRIVE_API_FAILED', 'DRIVE_UPLOAD_FAILED',
      ].includes(code) ? code : 'EXPORT_FAILED';
      setExportError(t(`backup.export.error.${known}`));
    } finally {
      setExportProgress(null);
    }
  };

  const confirmUndo = () => {
    if (undo?.state !== 'available' || undoState !== 'idle') return;
    Alert.alert(t('backup.undo.confirmTitle'), t('backup.undo.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('backup.undo.action'),
        style: 'destructive',
        onPress: async () => {
          setUndoState('committing');
          setUndoMessage(null);
          try {
            await runForegroundOperation(() => undoFullReplacement(undo));
            setUndoMessage('success');
          } catch (error) {
            console.warn('Failed to undo full replacement:', error);
            setUndoMessage('failed');
          } finally {
            await loadUndo();
          }
        },
      },
    ]);
  };

  const disconnect = () => {
    Alert.alert(t('backup.disconnectTitle'), t('backup.disconnectBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('backup.disconnect'),
        style: 'destructive',
        onPress: async () => {
          // The confirmation dialog can remain open while another operation
          // starts. Re-check at commit time so disconnect cannot race an
          // export/import and invalidate its Drive target mid-flight.
          if (foregroundOperationInFlightRef.current || operationBusy) return;
          try {
            await disconnectBackupFolder();
            await refreshBackupDiscovery();
          } catch (error) {
            console.warn('Failed to disconnect backup folder:', error);
            Alert.alert(t('common.error'), t('backup.disconnectError'));
          }
        },
      },
    ]);
  };

  const isConnected = folder.status === 'connected';
  const operationBusy = liveProgress !== null || operationRunning || activeOperation !== null || exportProgress !== null || undoState === 'committing' || isDeletingArchives;

  useEffect(() => {
    if (!operationBusy) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled || operationStatusPollInFlightRef.current) return;
      operationStatusPollInFlightRef.current = true;
      try {
        await loadOperationStatus();
      } finally {
        operationStatusPollInFlightRef.current = false;
      }
    };
    void poll();
    const interval = setInterval(() => { void poll(); }, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [loadOperationStatus, operationBusy]);

  const hasStaleAuthorization = folder.status === 'revoked' || folder.status === 'unavailable';
  const statusColor = isConnected ? colors.primary : hasStaleAuthorization ? colors.error : colors.textSecondary;
  const statusIcon = isConnected ? 'folder-check-outline' : hasStaleAuthorization ? 'folder-alert-outline' : 'folder-outline';
  const archives = [...(collection?.archives ?? [])].sort((left, right) =>
    (Date.parse(right.createdAt ?? '') || right.providerModifiedAt || 0) -
    (Date.parse(left.createdAt ?? '') || left.providerModifiedAt || 0)
  );
  useEffect(() => {
    const available = new Set(archives.map((archive) => archive.uri));
    setSelectedArchiveUris((current) => {
      const next = new Set([...current].filter((uri) => available.has(uri)));
      return next.size === current.size ? current : next;
    });
  }, [collection]);
  const newestValid = collection?.complete
    ? archives.find((archive) => archive.state === 'valid') ?? null
    : null;
  const formatDate = (archive: BackupCollectionArchive) => {
    const value = archive.createdAt ? Date.parse(archive.createdAt) : archive.providerModifiedAt;
    if (!value || Number.isNaN(value)) return t('backup.collection.unknownTime');
    return formatBackupDate(value, language) ?? t('backup.collection.unknownTime');
  };
  const formatBytes = (bytes: number | null) => {
    if (bytes === null) return t('backup.collection.unknownSize');
    const units = ['B', 'KB', 'MB', 'GB'] as const;
    const unit = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), units.length - 1);
    return `${new Intl.NumberFormat(language === 'bn' ? 'bn-BD' : 'en-US', { maximumFractionDigits: 1 }).format(bytes / 1024 ** unit)} ${units[unit]}`;
  };
  return (
    <ScreenContainer>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + ui.space.sm + TOP_BAR_HEIGHT + ui.space.md,
          paddingHorizontal: ui.space.lg,
          paddingBottom: Math.max(insets.bottom + ui.space.xxl, ui.space.xxxl),
          gap: ui.space.lg,
        }}
      >
        <View style={{ gap: ui.space.sm }}>
          <AppText variant="display">{t('header.backup')}</AppText>
          {liveProgress ? <BackupProgressCard progress={liveProgress} /> : null}
        </View>

        <Card style={{ gap: ui.space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ui.space.md }}>
            <View style={{ flex: 1, gap: ui.space.xs }}>
              <AppText variant="headline">{t('backup.automatic.title')}</AppText>
              <AppText variant="bodySmall" color={colors.textSecondary}>
                {t('backup.automatic.help', { hours: automatic?.intervalHours ?? DEFAULT_AUTOMATIC_BACKUP_INTERVAL_HOURS })}
              </AppText>
            </View>
            <Switch
              accessibilityLabel={t('backup.automatic.title')}
              disabled={automatic === null || isChangingAutomatic || operationBusy}
              value={automatic?.enabled ?? false}
              onValueChange={(enabled) => void changeAutomatic(enabled)}
            />
          </View>
          <View style={{ gap: ui.space.xs }}>
            <AppText variant="caption" color={colors.textSecondary}>{t('backup.automatic.intervalLabel')}</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ui.space.sm }}>
              {AUTOMATIC_BACKUP_INTERVAL_HOURS.map((hours) => {
                const selected = automatic?.intervalHours === hours;
                return (
                  <PressableScale
                    key={hours}
                    accessibilityRole="radio"
                    accessibilityLabel={t('backup.automatic.interval', { hours })}
                    accessibilityState={{ selected, disabled: automatic === null || isChangingAutomatic || operationBusy }}
                    disabled={automatic === null || isChangingAutomatic || operationBusy}
                    onPress={() => void changeAutomaticInterval(hours)}
                    style={{
                      borderRadius: ui.radius.pill,
                      borderWidth: 1,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.surfaceVariant : 'transparent',
                      paddingHorizontal: ui.space.md,
                      paddingVertical: ui.space.sm,
                    }}
                  >
                    <AppText variant="bodySmall" color={selected ? colors.primary : colors.textSecondary}>
                      {t('backup.automatic.interval', { hours })}
                    </AppText>
                  </PressableScale>
                );
              })}
            </View>
          </View>
          <AppText
            variant="body"
            color={automatic?.phase === 'failed' || automatic?.phase === 'permission' || automatic?.phase === 'provider'
              ? colors.error
              : automatic?.phase === 'verified' ? colors.primary : colors.textSecondary}
          >
            {automatic ? t(`backup.automatic.status.${automatic.phase}`) : t('common.loading')}
          </AppText>
        </Card>

        <Card style={{ gap: ui.space.lg }}>
          <View style={{ gap: ui.space.xs }}>
            <AppText variant="caption" color={colors.textSecondary}>{t('backup.collection.newest')}</AppText>
            <AppText variant="headline" color={newestValid ? colors.primary : colors.textSecondary}>
              {newestValid
                ? formatDate(newestValid)
                : scanState !== 'idle' || collection?.complete === false
                  ? t('backup.collection.recoveryUnknown')
                  : t('backup.collection.noRecoveryPoint')}
            </AppText>
          </View>
          <View style={{ gap: ui.space.xs }}>
            <AppText variant="headline">{t('backup.export.title')}</AppText>
            <AppText variant="bodySmall" color={colors.textSecondary}>
              {t('backup.export.help')}
            </AppText>
          </View>
          <PrimaryButton onPress={() => void startExport()} disabled={!isConnected || operationBusy}>
            {exportProgress ? t(`backup.export.progress.${exportProgress}`) : t('backup.export.action')}
          </PrimaryButton>
          {verifiedBackup ? (
            <View style={{ gap: ui.space.xs }}>
              <AppText variant="headline" color={colors.primary}>{t('backup.export.success')}</AppText>
              <AppText variant="bodySmall" color={colors.textSecondary}>{verifiedBackup.name}</AppText>
            </View>
          ) : null}
          {exportError ? <AppText variant="body" color={colors.error}>{exportError}</AppText> : null}
        </Card>

        {undoState === 'loading' || undo?.state !== 'none' || undoMessage ? (
          <Card style={{ gap: ui.space.md }}>
            <AppText variant="headline">{t('backup.undo.title')}</AppText>
            <AppText variant="body" color={undo?.state === 'available' ? colors.primary : undoMessage === 'success' ? colors.primary : colors.error}>
              {undoMessage === 'success'
                ? t('backup.undo.success')
                : undoMessage === 'failed'
                  ? t('backup.undo.failed')
                  : undoState === 'loading'
                    ? t('common.loading')
                    : t(`backup.undo.state.${undo?.state ?? 'unavailable'}`, {
                        time: undo?.expiresAt
                          ? new Intl.DateTimeFormat(language === 'bn' ? 'bn-BD' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(undo.expiresAt))
                          : '',
                      })}
            </AppText>
            {undo?.state === 'available' ? (
              <PrimaryButton disabled={undoState !== 'idle' || operationBusy} onPress={confirmUndo}>
                {undoState === 'committing' ? t('backup.undo.committing') : t('backup.undo.action')}
              </PrimaryButton>
            ) : null}
          </Card>
        ) : null}

        {isConnected ? (
          <Card style={{ gap: ui.space.md }}>
            <AppText variant="headline">{t('backup.import.title')}</AppText>
            <PrimaryButton disabled={operationBusy} onPress={() => navigation.navigate('ImportBackup')}>
              {t('backup.import.action')}
            </PrimaryButton>
          </Card>
        ) : null}

        {isConnected ? (
          <Card style={{ gap: ui.space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ui.space.sm }}>
              <AppText variant="headline">{t('backup.collection.title')}</AppText>
              <PressableScale
                accessibilityRole="button"
                disabled={scanState === 'loading' || operationBusy}
                onPress={() => void scanCollection()}
                style={{ padding: ui.space.sm }}
              >
                <AppText variant="headline" color={colors.primary}>
                  {scanState === 'loading' ? t('backup.collection.scanning') : t('backup.collection.refresh')}
                </AppText>
              </PressableScale>
            </View>
            {scanState === 'failed' ? (
              <AppText variant="body" color={colors.error}>{t('backup.collection.failed')}</AppText>
            ) : collection && !collection.complete ? (
              <AppText variant="body" color={colors.error}>{t('backup.collection.incomplete')}</AppText>
            ) : null}
            {retention ? (
              <AppText
                variant="bodySmall"
                color={retention.status === 'applied' || retention.status === 'nothing_to_prune'
                  ? colors.textSecondary
                  : colors.error}
              >
                {t(`backup.retention.status.${retention.status}`, { count: retention.deletedCount })}
              </AppText>
            ) : null}
            {selectedArchiveUris.size > 0 ? (
              <View style={{ gap: ui.space.sm }}>
                <AppText variant="bodySmall" color={colors.textSecondary}>
                  {t('backup.collection.selected', { count: selectedArchiveUris.size })}
                </AppText>
                <PrimaryButton
                  disabled={isDeletingArchives || operationBusy}
                  onPress={confirmDeleteArchives}
                >
                  {isDeletingArchives ? t('backup.collection.deleting') : t('backup.collection.delete')}
                </PrimaryButton>
              </View>
            ) : null}
            {scanState !== 'loading' && collection && archives.length === 0 ? (
              <AppText variant="body" color={colors.textSecondary}>{t('backup.collection.empty')}</AppText>
            ) : null}
            {archives.map((archive) => {
              const color = archive.state === 'valid'
                ? colors.primary
                : archive.state === 'uncertain' ? colors.textSecondary : colors.error;
              return (
                <PressableScale
                  key={archive.uri}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${t('backup.collection.select')}: ${archive.name}`}
                  accessibilityState={{ checked: selectedArchiveUris.has(archive.uri) }}
                  disabled={isDeletingArchives || operationBusy}
                  onPress={() => toggleSelectedArchive(archive.uri)}
                  style={{ gap: ui.space.xs, paddingTop: ui.space.sm, borderTopWidth: 1, borderTopColor: colors.border }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: ui.space.sm, alignItems: 'center' }}>
                    <MaterialCommunityIcons
                      name={selectedArchiveUris.has(archive.uri) ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={22}
                      color={selectedArchiveUris.has(archive.uri) ? colors.primary : colors.textSecondary}
                    />
                    <AppText variant="headline" style={{ flex: 1 }}>{formatDate(archive)}</AppText>
                    <AppText variant="headline" color={color}>{t(`backup.collection.state.${archive.state}`)}</AppText>
                  </View>
                  <AppText variant="bodySmall" color={colors.textSecondary} numberOfLines={1}>{archive.name}</AppText>
                  <AppText variant="bodySmall" color={colors.textSecondary}>
                    {formatBytes(archive.bytes)} · {t(`backup.collection.verification.${archive.verification}`)} · {t(`backup.collection.compatibility.${archive.compatibility}`)}
                  </AppText>
                </PressableScale>
              );
            })}
          </Card>
        ) : null}

        <Card style={{ gap: ui.space.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: ui.space.md }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: ui.radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surfaceVariant,
              }}
            >
              <MaterialCommunityIcons name={statusIcon} size={26} color={statusColor} />
            </View>
            <View style={{ flex: 1, gap: ui.space.xs }}>
              <AppText variant="headline">
                {isLoading ? t('common.loading') : t(`backup.status.${folder.status}`)}
              </AppText>
              <AppText variant="bodySmall" color={colors.textSecondary} numberOfLines={3}>
                {isConnected
                  ? t('backup.connectedHelp')
                  : hasStaleAuthorization
                    ? t(`backup.help.${folder.status}`)
                    : t('backup.disconnectedHelp')}
              </AppText>
            </View>
          </View>

          {folder.name || folder.uri ? (
            <View style={{ gap: ui.space.xs }}>
              <AppText variant="caption" color={colors.textSecondary}>
                {t('backup.folderLabel')}
              </AppText>
              <AppText variant="body" numberOfLines={2}>
                {folder.name ?? folder.uri}
              </AppText>
            </View>
          ) : null}

          <PrimaryButton onPress={() => void chooseFolder()} disabled={isLoading || isChoosing || operationBusy}>
            {isChoosing
              ? t('backup.openingPicker')
              : isConnected || hasStaleAuthorization
                ? t('backup.changeFolder')
                : t('backup.connectFolder')}
          </PrimaryButton>

          {!isConnected ? (
            <PressableScale
              accessibilityRole="button"
              disabled={isLoading || scanState === 'loading'}
              onPress={() => void scanCollection()}
              style={{ alignSelf: 'center', padding: ui.space.sm }}
            >
              <AppText variant="headline" color={colors.primary}>
                {scanState === 'loading' ? t('backup.collection.scanning') : t('backup.collection.refresh')}
              </AppText>
            </PressableScale>
          ) : null}

          {isConnected || hasStaleAuthorization ? (
            <PressableScale
              accessibilityRole="button"
              disabled={operationBusy || isChoosing}
              onPress={disconnect}
              style={{ alignSelf: 'center', padding: ui.space.sm }}
            >
              <AppText variant="headline" color={colors.error}>
                {hasStaleAuthorization ? t('backup.clearFolder') : t('backup.disconnect')}
              </AppText>
            </PressableScale>
          ) : null}
        </Card>

        <BackupTestingNotice />

        <AppText variant="bodySmall" color={colors.textSecondary}>
          {t('backup.deviceLocal')}
        </AppText>
      </ScrollView>

      <TopBar onBack={() => navigation.goBack()}>
        <LanguageToggleButton />
      </TopBar>
    </ScreenContainer>
  );
};
