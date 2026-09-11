import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../components/AppText';
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
  getBackupFolderState,
  type BackupFolderState,
} from '../services/backupFolder';
import { exportBackup, type ExportProgress, type VerifiedBackup } from '../services/backupExport';
import {
  browseArchiveForImport,
  importAllNotesAdditively,
  importAllNotesByReplacement,
  importSelectedNotes,
  loadFullReplacementUndo,
  previewNewestArchive,
  undoFullReplacement,
} from '../services/backupImport';
import {
  scanBackupCollection,
  type BackupCollectionArchive,
  type BackupCollectionScan,
  type ImportPreview,
  type FullReplacementResult,
  type FullReplacementUndo,
  type ImportResult,
} from '../services/archive';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { RootStackParamList } from '../types/navigation';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'Backup'>;

const EMPTY_STATE: BackupFolderState = { status: 'disconnected', uri: null, name: null };

export const BackupScreen = () => {
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const { colors } = useAppColors();
  const { language, t } = useLanguage();
  const [folder, setFolder] = useState<BackupFolderState>(EMPTY_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [isChoosing, setIsChoosing] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [verifiedBackup, setVerifiedBackup] = useState<VerifiedBackup | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [collection, setCollection] = useState<BackupCollectionScan | null>(null);
  const [scanState, setScanState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importMode, setImportMode] = useState<'selective' | 'additive' | 'replacement' | null>(null);
  const [selectedNoteIds, setSelectedNoteIds] = useState<ReadonlySet<string>>(new Set());
  const [importState, setImportState] = useState<'idle' | 'previewing' | 'committing'>('idle');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [replacementResult, setReplacementResult] = useState<FullReplacementResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [undo, setUndo] = useState<FullReplacementUndo | null>(null);
  const [undoState, setUndoState] = useState<'idle' | 'loading' | 'committing'>('loading');
  const [undoMessage, setUndoMessage] = useState<'success' | 'failed' | null>(null);

  const loadUndo = useCallback(async () => {
    setUndoState('loading');
    try {
      setUndo(await loadFullReplacementUndo());
    } catch (error) {
      console.warn('Failed to inspect full replacement undo:', error);
      setUndo({ state: 'unavailable', snapshotId: null, expiresAt: null });
    } finally {
      setUndoState('idle');
    }
  }, []);

  const scanCollection = useCallback(async () => {
    setScanState('loading');
    try {
      setCollection(await scanBackupCollection());
      setScanState('idle');
    } catch (error) {
      console.warn('Failed to scan backup collection:', error);
      setCollection(null);
      setScanState('failed');
    }
  }, []);

  const loadFolder = useCallback(async () => {
    try {
      const nextFolder = await getBackupFolderState();
      setFolder(nextFolder);
      if (nextFolder.status === 'connected') await scanCollection();
      else {
        setCollection(null);
        setScanState('idle');
      }
    } catch (error) {
      console.warn('Failed to restore backup folder authorization:', error);
      setFolder({ status: 'unavailable', uri: null, name: null });
      setCollection(null);
      setScanState('failed');
    } finally {
      setIsLoading(false);
    }
  }, [scanCollection]);

  useFocusEffect(
    useCallback(() => {
      void loadFolder();
      void loadUndo();
    }, [loadFolder, loadUndo])
  );

  const chooseFolder = async () => {
    try {
      setIsChoosing(true);
      const nextFolder = await chooseBackupFolder();
      setFolder(nextFolder);
      if (nextFolder.status === 'connected') await scanCollection();
    } catch (error) {
      if ((error as { code?: string }).code === 'PICKER_CANCELLED') return;
      console.warn('Failed to choose backup folder:', error);
      Alert.alert(t('common.error'), t('backup.chooseError'));
    } finally {
      setIsChoosing(false);
    }
  };

  const startExport = async () => {
    setExportError(null);
    setVerifiedBackup(null);
    try {
      const result = await exportBackup(setExportProgress);
      setVerifiedBackup(result);
      await scanCollection();
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : error instanceof Error ? error.message : 'EXPORT_FAILED';
      const known = [
        'INSUFFICIENT_STORAGE', 'DESTINATION_STORAGE_INSUFFICIENT', 'PROVIDER_INTERRUPTED',
        'PARTIAL_WRITE', 'PARTIAL_OUTPUT_REMAINS', 'OUTPUT_RENAMED', 'STAGING_MISSING',
        'DESTINATION_VERIFICATION_FAILED',
      ].includes(code) ? code : 'EXPORT_FAILED';
      setExportError(t(`backup.export.error.${known}`));
    } finally {
      setExportProgress(null);
    }
  };

  const openImportPreview = async (archiveUri?: string) => {
    setImportState('previewing');
    setImportError(null);
    setImportResult(null);
    setReplacementResult(null);
    try {
      const preview = archiveUri
        ? await previewNewestArchive(archiveUri)
        : await browseArchiveForImport();
      if (!preview) return;
      setImportPreview(preview);
      setImportMode(null);
      setSelectedNoteIds(new Set(preview.notes.map((note) => note.portableId)));
    } catch (error) {
      console.warn('Failed to preview backup archive:', error);
      setImportError(t('backup.import.invalid'));
    } finally {
      setImportState('idle');
    }
  };

  const toggleSelectedNote = (portableId: string) => {
    setSelectedNoteIds((current) => {
      const next = new Set(current);
      if (next.has(portableId)) next.delete(portableId);
      else next.add(portableId);
      return next;
    });
  };

  const commitImport = async () => {
    if (!importPreview || !importMode || (importMode === 'selective' && selectedNoteIds.size === 0)) return;
    setImportState('committing');
    setImportError(null);
    try {
      const result = importMode === 'additive'
        ? await importAllNotesAdditively(importPreview)
        : await importSelectedNotes(importPreview, [...selectedNoteIds]);
      setImportResult(result);
      setImportPreview(null);
      setImportMode(null);
      setSelectedNoteIds(new Set());
    } catch (error) {
      console.warn('Failed to import selected notes:', error);
      setImportError(t('backup.import.failed'));
    } finally {
      setImportState('idle');
    }
  };

  const confirmReplacement = () => {
    if (!importPreview || importState !== 'idle') return;
    Alert.alert(t('backup.import.replacementConfirmTitle'), t('backup.import.replacementConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('backup.import.replacementConfirm'),
        style: 'destructive',
        onPress: async () => {
          setImportMode('replacement');
          setImportState('committing');
          setImportError(null);
          try {
            setReplacementResult(await importAllNotesByReplacement(importPreview));
            setUndoMessage(null);
            await loadUndo();
            setImportPreview(null);
            setImportMode(null);
            setSelectedNoteIds(new Set());
          } catch (error) {
            console.warn('Failed to replace content from backup:', error);
            setImportError(t('backup.import.replacementFailed'));
          } finally {
            setImportState('idle');
          }
        },
      },
    ]);
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
            await undoFullReplacement(undo);
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
          try {
            setFolder(await disconnectBackupFolder());
            setCollection(null);
            setScanState('idle');
          } catch (error) {
            console.warn('Failed to disconnect backup folder:', error);
            Alert.alert(t('common.error'), t('backup.disconnectError'));
          }
        },
      },
    ]);
  };

  const isConnected = folder.status === 'connected';
  const hasStaleAuthorization = folder.status === 'revoked' || folder.status === 'unavailable';
  const statusColor = isConnected ? colors.primary : hasStaleAuthorization ? colors.error : colors.textSecondary;
  const statusIcon = isConnected ? 'folder-check-outline' : hasStaleAuthorization ? 'folder-alert-outline' : 'folder-outline';
  const archives = [...(collection?.archives ?? [])].sort((left, right) =>
    (Date.parse(right.createdAt ?? '') || right.providerModifiedAt || 0) -
    (Date.parse(left.createdAt ?? '') || left.providerModifiedAt || 0)
  );
  const newestValid = collection?.complete
    ? archives.find((archive) => archive.state === 'valid') ?? null
    : null;
  const formatDate = (archive: BackupCollectionArchive) => {
    const value = archive.createdAt ? Date.parse(archive.createdAt) : archive.providerModifiedAt;
    if (!value || Number.isNaN(value)) return t('backup.collection.unknownTime');
    return new Intl.DateTimeFormat(language === 'bn' ? 'bn-BD' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  };
  const formatBytes = (bytes: number | null) => {
    if (bytes === null) return t('backup.collection.unknownSize');
    const units = ['B', 'KB', 'MB', 'GB'] as const;
    const unit = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), units.length - 1);
    return `${new Intl.NumberFormat(language === 'bn' ? 'bn-BD' : 'en-US', { maximumFractionDigits: 1 }).format(bytes / 1024 ** unit)} ${units[unit]}`;
  };
  const recoveryRestrictionText = (result: ImportResult | FullReplacementResult) =>
    result.recoveryComplete
      ? t('backup.import.restriction.complete')
      : t('backup.import.restriction.incomplete', {
          audio: result.restrictedAudioCount,
          files: result.restrictedFileCount,
        });

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
          <AppText variant="body" color={colors.textSecondary}>
            {t('backup.intro')}
          </AppText>
        </View>

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
          <PrimaryButton onPress={() => void startExport()} disabled={!isConnected || exportProgress !== null}>
            {exportProgress ? t(`backup.export.progress.${exportProgress}`) : t('backup.export.action')}
          </PrimaryButton>
          {exportProgress ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: ui.space.sm }}>
              <ActivityIndicator color={colors.primary} />
              <AppText variant="body" color={colors.textSecondary}>
                {t(`backup.export.progress.${exportProgress}`)}
              </AppText>
            </View>
          ) : null}
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
              <PrimaryButton disabled={undoState !== 'idle'} onPress={confirmUndo}>
                {undoState === 'committing' ? t('backup.undo.committing') : t('backup.undo.action')}
              </PrimaryButton>
            ) : null}
          </Card>
        ) : null}

        {isConnected ? (
          <Card style={{ gap: ui.space.md }}>
            <AppText variant="headline">{t('backup.import.title')}</AppText>
            <AppText variant="bodySmall" color={colors.textSecondary}>{t('backup.import.help')}</AppText>
            <PrimaryButton
              disabled={!newestValid || importState !== 'idle'}
              onPress={() => newestValid && void openImportPreview(newestValid.uri)}
            >
              {importState === 'previewing' ? t('backup.import.validating') : t('backup.import.newest')}
            </PrimaryButton>
            <PressableScale
              accessibilityRole="button"
              disabled={importState !== 'idle'}
              onPress={() => void openImportPreview()}
              style={{ alignSelf: 'center', padding: ui.space.sm }}
            >
              <AppText variant="headline" color={colors.primary}>{t('backup.import.browse')}</AppText>
            </PressableScale>
            {importError ? <AppText variant="body" color={colors.error}>{importError}</AppText> : null}
            {importResult ? (
              <View style={{ gap: ui.space.xs }}>
                <AppText variant="body" color={colors.primary}>
                  {t('backup.import.success', {
                    imported: importResult.importedCount - importResult.recoveredCount,
                    recovered: importResult.recoveredCount,
                    skipped: importResult.skippedCount,
                  })}
                </AppText>
                <AppText variant="body" color={importResult.recoveryComplete ? colors.primary : colors.error}>
                  {recoveryRestrictionText(importResult)}
                </AppText>
              </View>
            ) : null}
            {replacementResult ? (
              <View style={{ gap: ui.space.xs }}>
                <AppText variant="body" color={colors.primary}>
                  {t('backup.import.replacementSuccess', { count: replacementResult.restoredNoteCount })}
                </AppText>
                <AppText variant="body" color={replacementResult.recoveryComplete ? colors.primary : colors.error}>
                  {recoveryRestrictionText(replacementResult)}
                </AppText>
              </View>
            ) : null}
          </Card>
        ) : null}

        {importPreview ? (
          <Card style={{ gap: ui.space.md }}>
            <AppText variant="headline">{t('backup.import.modeTitle')}</AppText>
            <AppText variant="bodySmall" color={colors.textSecondary}>{t('backup.import.noOverwrite')}</AppText>
            <PrimaryButton disabled={importState !== 'idle'} onPress={() => setImportMode('additive')}>
              {t('backup.import.additive')}
            </PrimaryButton>
            <AppText variant="bodySmall" color={colors.textSecondary}>{t('backup.import.additiveHelp')}</AppText>
            <PressableScale
              accessibilityRole="button"
              disabled={importState !== 'idle'}
              onPress={() => setImportMode('selective')}
              style={{ alignSelf: 'center', padding: ui.space.sm }}
            >
              <AppText variant="headline" color={colors.primary}>{t('backup.import.selective')}</AppText>
            </PressableScale>
            {importMode === 'selective' ? importPreview.notes.map((note) => {
              const selected = selectedNoteIds.has(note.portableId);
              return (
                <PressableScale
                  key={note.portableId}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  onPress={() => toggleSelectedNote(note.portableId)}
                  style={{ paddingVertical: ui.space.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: ui.space.xs }}
                >
                  <View style={{ flexDirection: 'row', gap: ui.space.sm, alignItems: 'center' }}>
                    <MaterialCommunityIcons name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'} size={24} color={selected ? colors.primary : colors.textSecondary} />
                    <View style={{ flex: 1 }}>
                      <AppText variant="headline">{note.title}</AppText>
                      <AppText variant="bodySmall" color={colors.textSecondary}>{note.folderName}</AppText>
                    </View>
                  </View>
                  {note.contentPreview ? <AppText variant="bodySmall" color={colors.textSecondary} numberOfLines={2}>{note.contentPreview}</AppText> : null}
                  <AppText variant="caption" color={colors.textSecondary}>
                    {t('backup.import.media', { audio: note.audioCount, files: note.fileCount })}
                  </AppText>
                </PressableScale>
              );
            }) : null}
            {importMode ? (
              <PrimaryButton
                disabled={(importMode === 'selective' && selectedNoteIds.size === 0) || importState !== 'idle'}
                onPress={() => void commitImport()}
              >
                {importState === 'committing'
                  ? t('backup.import.committing')
                  : importMode === 'additive'
                    ? t('backup.import.additiveConfirm', { count: importPreview.notes.length })
                    : t('backup.import.selected', { count: selectedNoteIds.size })}
              </PrimaryButton>
            ) : null}
            <View style={{ gap: ui.space.sm, borderTopWidth: 2, borderTopColor: colors.error, paddingTop: ui.space.lg, marginTop: ui.space.sm }}>
              <AppText variant="headline" color={colors.error}>{t('backup.import.replacement')}</AppText>
              <AppText variant="bodySmall" color={colors.error}>{t('backup.import.replacementHelp')}</AppText>
              <PrimaryButton disabled={importState !== 'idle'} onPress={confirmReplacement}>
                {importState === 'committing' && importMode === 'replacement'
                  ? t('backup.import.replacementCommitting')
                  : t('backup.import.replacementAction')}
              </PrimaryButton>
            </View>
            <PressableScale onPress={() => { setImportPreview(null); setImportMode(null); }} style={{ alignSelf: 'center', padding: ui.space.sm }}>
              <AppText variant="headline" color={colors.textSecondary}>{t('common.cancel')}</AppText>
            </PressableScale>
          </Card>
        ) : null}

        {isConnected ? (
          <Card style={{ gap: ui.space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ui.space.sm }}>
              <AppText variant="headline">{t('backup.collection.title')}</AppText>
              <PressableScale
                accessibilityRole="button"
                disabled={scanState === 'loading'}
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
            {scanState !== 'loading' && collection && archives.length === 0 ? (
              <AppText variant="body" color={colors.textSecondary}>{t('backup.collection.empty')}</AppText>
            ) : null}
            {archives.map((archive) => {
              const color = archive.state === 'valid'
                ? colors.primary
                : archive.state === 'uncertain' ? colors.textSecondary : colors.error;
              return (
                <View
                  key={archive.uri}
                  style={{ gap: ui.space.xs, paddingTop: ui.space.sm, borderTopWidth: 1, borderTopColor: colors.border }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: ui.space.sm }}>
                    <AppText variant="headline" style={{ flex: 1 }}>{formatDate(archive)}</AppText>
                    <AppText variant="headline" color={color}>{t(`backup.collection.state.${archive.state}`)}</AppText>
                  </View>
                  <AppText variant="bodySmall" color={colors.textSecondary} numberOfLines={1}>{archive.name}</AppText>
                  <AppText variant="bodySmall" color={colors.textSecondary}>
                    {formatBytes(archive.bytes)} · {t(`backup.collection.verification.${archive.verification}`)} · {t(`backup.collection.compatibility.${archive.compatibility}`)}
                  </AppText>
                </View>
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

          <PrimaryButton onPress={() => void chooseFolder()} disabled={isLoading || isChoosing}>
            {isChoosing
              ? t('backup.openingPicker')
              : isConnected || hasStaleAuthorization
                ? t('backup.changeFolder')
                : t('backup.connectFolder')}
          </PrimaryButton>

          {isConnected || hasStaleAuthorization ? (
            <PressableScale
              accessibilityRole="button"
              onPress={disconnect}
              style={{ alignSelf: 'center', padding: ui.space.sm }}
            >
              <AppText variant="headline" color={colors.error}>
                {hasStaleAuthorization ? t('backup.clearFolder') : t('backup.disconnect')}
              </AppText>
            </PressableScale>
          ) : null}
        </Card>

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
