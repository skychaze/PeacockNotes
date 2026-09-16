import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildArchiveTree, folderCheckState, resolvePreviewFolders, toggleArchiveNotes, type ArchiveTreeFolder } from '../backup/archiveTree';
import { AppText } from '../components/AppText';
import { Card } from '../components/Card';
import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { PressableScale } from '../components/PressableScale';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { TOP_BAR_HEIGHT, TopBar } from '../components/TopBar';
import { useLanguage } from '../i18n/LanguageContext';
import type { BackupCollectionArchive, FullReplacementResult, ImportPreview, ImportResult } from '../services/archive';
import { getActiveBackupOperation } from '../services/backupBackground';
import { getBackupDiscoverySnapshot, initializeBackupDiscovery, refreshBackupDiscovery, subscribeBackupDiscovery } from '../services/backupDiscovery';
import { releaseBackupForegroundService, startBackupForegroundService } from '../services/backupFolder';
import {
  browseArchiveForImport,
  importAllNotesAdditively,
  importAllNotesByReplacement,
  importSelectedNotes,
  previewNewestArchive,
} from '../services/backupImport';
import { requestBackupNotificationPermissionOnce } from '../services/backupNotificationPermission';
import { beginBackupProgress, createBackupProgressOperationId, finishBackupProgress } from '../services/backupProgress';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { RootStackParamList } from '../types/navigation';
import { formatBackupDate } from '../utils/backupDate';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'ImportBackup'>;

const IMPORT_PREVIEW_ERROR_KEYS: Record<string, string> = {
  DRIVE_AUTH_REQUIRED: 'backup.import.error.DRIVE_AUTH_REQUIRED',
  DRIVE_AUTH_FAILED: 'backup.import.error.DRIVE_AUTH_REQUIRED',
  DRIVE_API_FORBIDDEN: 'backup.import.error.DRIVE_API_FORBIDDEN',
  DRIVE_RATE_LIMITED: 'backup.import.error.DRIVE_RATE_LIMITED',
  DRIVE_UNAVAILABLE: 'backup.import.error.DRIVE_UNAVAILABLE',
  DRIVE_API_FAILED: 'backup.import.error.DRIVE_API_FAILED',
  INSUFFICIENT_STORAGE: 'backup.import.error.INSUFFICIENT_STORAGE',
};

export const ImportBackupScreen = () => {
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const { colors } = useAppColors();
  const { language, t } = useLanguage();
  const [discovery, setDiscovery] = useState(getBackupDiscoverySnapshot());
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selectedNoteIds, setSelectedNoteIds] = useState<ReadonlySet<string>>(new Set());
  const [expandedFolderIds, setExpandedFolderIds] = useState<ReadonlySet<string>>(new Set());
  const [state, setState] = useState<'idle' | 'previewing' | 'committing'>('idle');
  const [result, setResult] = useState<ImportResult | FullReplacementResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const operationInFlightRef = useRef(false);

  useEffect(() => () => { mountedRef.current = false; }, []);
  useEffect(() => subscribeBackupDiscovery(setDiscovery), []);
  useFocusEffect(useCallback(() => { void initializeBackupDiscovery(); }, []));

  const runForegroundOperation = async <T,>(work: () => Promise<T>): Promise<T> => {
    if (operationInFlightRef.current || await getActiveBackupOperation()) throw new Error('BACKUP_OPERATION_BUSY');
    operationInFlightRef.current = true;
    let serviceStarted = false;
    let completed = false;
    try {
      await requestBackupNotificationPermissionOnce();
      await startBackupForegroundService();
      serviceStarted = true;
      const value = await work();
      completed = true;
      return value;
    } finally {
      if (serviceStarted) {
        try {
          await releaseBackupForegroundService(completed);
        } catch (releaseError) {
          console.warn('Failed to release backup foreground service:', releaseError);
        }
      }
      operationInFlightRef.current = false;
    }
  };

  const openPreview = async (archiveUri?: string) => {
    if (state !== 'idle') return;
    setState('previewing');
    setError(null);
    setResult(null);
    try {
      const uri = archiveUri ?? await browseArchiveForImport();
      if (!uri) return;
      const loaded = await runForegroundOperation(async () => {
        const owner = { operationId: createBackupProgressOperationId(), operationKind: 'preview' };
        await beginBackupProgress({ ...owner, phase: 'verify', step: 'read_archive' });
        try {
          return await previewNewestArchive(uri, owner);
        } finally {
          finishBackupProgress(owner);
        }
      });
      if (!mountedRef.current) return;
      setPreview(loaded);
      setSelectedNoteIds(new Set(loaded.notes.map((note) => note.portableId)));
      setExpandedFolderIds(new Set());
    } catch (previewError: unknown) {
      console.warn('Failed to preview backup archive:', previewError);
      const code = typeof previewError === 'object' && previewError !== null && 'code' in previewError
        ? String(previewError.code)
        : '';
      if (mountedRef.current) setError(t(IMPORT_PREVIEW_ERROR_KEYS[code] ?? 'backup.import.invalid'));
    } finally {
      if (mountedRef.current) setState('idle');
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

  const toggleFolder = (folder: ArchiveTreeFolder) => {
    setSelectedNoteIds((current) => toggleArchiveNotes(
      current,
      folder.descendantNoteIds,
      folderCheckState(folder.descendantNoteIds, current) !== 'checked',
    ));
  };

  const toggleExpandedFolder = (portableId: string) => {
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(portableId)) next.delete(portableId);
      else next.add(portableId);
      return next;
    });
  };

  const tree = preview ? buildArchiveTree(resolvePreviewFolders(preview), preview.notes) : [];
  const renderFolder = (folder: ArchiveTreeFolder, depth = 0): ReactNode => {
    const expanded = expandedFolderIds.has(folder.portableId);
    const checkState = folderCheckState(folder.descendantNoteIds, selectedNoteIds);
    const checkboxIcon = checkState === 'checked' ? 'checkbox-marked' : checkState === 'indeterminate' ? 'minus-box' : 'checkbox-blank-outline';
    const toggleLabel = expanded ? t('backup.import.folderCollapse') : t('backup.import.folderExpand');
    return (
      <View key={folder.portableId} style={{ marginLeft: depth * ui.space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border }}>
          <PressableScale accessibilityRole="button" accessibilityLabel={`${toggleLabel} ${folder.name}`} onPress={() => toggleExpandedFolder(folder.portableId)} style={{ padding: ui.space.xs }}>
            <MaterialCommunityIcons name={expanded ? 'chevron-down' : 'chevron-right'} size={22} color={colors.textSecondary} />
          </PressableScale>
          <PressableScale
            accessibilityRole="checkbox"
            accessibilityState={{ checked: checkState === 'indeterminate' ? 'mixed' : checkState === 'checked', disabled: checkState === 'disabled' }}
            disabled={checkState === 'disabled'}
            onPress={() => toggleFolder(folder)}
            style={{ padding: ui.space.xs }}
          >
            <MaterialCommunityIcons name={checkboxIcon} size={24} color={checkState === 'checked' || checkState === 'indeterminate' ? colors.primary : colors.textSecondary} />
          </PressableScale>
          <PressableScale accessibilityRole="button" accessibilityLabel={`${toggleLabel} ${folder.name}`} onPress={() => toggleExpandedFolder(folder.portableId)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ui.space.sm, paddingVertical: ui.space.md, paddingRight: ui.space.xs }}>
            <AppText variant="headline" numberOfLines={1}>{folder.name}</AppText>
            <AppText variant="caption" color={colors.textSecondary}>{folder.descendantNoteIds.length}</AppText>
          </PressableScale>
        </View>
        {expanded ? (
          <>
            {folder.children.map((child) => renderFolder(child, depth + 1))}
            {folder.notes.map((note) => {
              const selected = selectedNoteIds.has(note.portableId);
              return (
                <PressableScale key={note.portableId} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => toggleSelectedNote(note.portableId)} style={{ marginLeft: ui.space.lg, paddingVertical: ui.space.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: ui.space.xs }}>
                  <View style={{ flexDirection: 'row', gap: ui.space.sm, alignItems: 'center' }}>
                    <MaterialCommunityIcons name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'} size={24} color={selected ? colors.primary : colors.textSecondary} />
                    <View style={{ flex: 1 }}>
                      <AppText variant="headline">{note.title}</AppText>
                      <AppText variant="bodySmall" color={colors.textSecondary}>{folder.path.join(' / ')}</AppText>
                    </View>
                  </View>
                  {note.contentPreview ? <AppText variant="bodySmall" color={colors.textSecondary} numberOfLines={2}>{note.contentPreview}</AppText> : null}
                  <AppText variant="caption" color={colors.textSecondary}>{t('backup.import.media', { audio: note.audioCount, files: note.fileCount })}</AppText>
                </PressableScale>
              );
            })}
          </>
        ) : null}
      </View>
    );
  };

  const commit = async (all: boolean) => {
    if (!preview || (!all && selectedNoteIds.size === 0) || state !== 'idle') return;
    setState('committing');
    setError(null);
    try {
      const imported = await runForegroundOperation(() => all
        ? importAllNotesAdditively(preview, t('backup.import.recoveredCopySuffix'))
        : importSelectedNotes(preview, [...selectedNoteIds], t('backup.import.recoveredCopySuffix')));
      if (mountedRef.current) {
        setResult(imported);
        setPreview(null);
      }
    } catch (commitError) {
      console.warn('Failed to import backup:', commitError);
      if (mountedRef.current) setError(t('backup.import.failed'));
    } finally {
      if (mountedRef.current) setState('idle');
    }
  };

  const confirmReplacement = () => {
    if (!preview || state !== 'idle') return;
    Alert.alert(t('backup.import.replacementConfirmTitle'), t('backup.import.replacementConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('backup.import.replacementConfirm'),
        style: 'destructive',
        onPress: async () => {
          setState('committing');
          setError(null);
          try {
            const replacement = await runForegroundOperation(() => importAllNotesByReplacement(preview));
            if (mountedRef.current) {
              setResult(replacement);
              setPreview(null);
            }
          } catch (replacementError) {
            console.warn('Failed to replace content from backup:', replacementError);
            if (mountedRef.current) setError(t('backup.import.replacementFailed'));
          } finally {
            if (mountedRef.current) setState('idle');
          }
        },
      },
    ]);
  };

  const archives = [...(discovery.value.collection?.archives ?? [])].sort((left, right) =>
    (Date.parse(right.createdAt ?? '') || right.providerModifiedAt || 0) -
    (Date.parse(left.createdAt ?? '') || left.providerModifiedAt || 0));
  const formatDate = (archive: BackupCollectionArchive) => {
    const value = archive.createdAt ? Date.parse(archive.createdAt) : archive.providerModifiedAt;
    return value && !Number.isNaN(value)
      ? formatBackupDate(value, language) ?? t('backup.collection.unknownTime')
      : t('backup.collection.unknownTime');
  };
  const recoveryRestrictionText = (importResult: ImportResult | FullReplacementResult) => importResult.recoveryComplete
    ? t('backup.import.restriction.complete')
    : t('backup.import.restriction.incomplete', { audio: importResult.restrictedAudioCount, files: importResult.restrictedFileCount });

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + ui.space.sm + TOP_BAR_HEIGHT + ui.space.md, paddingHorizontal: ui.space.lg, paddingBottom: Math.max(insets.bottom + ui.space.xxl, ui.space.xxxl), gap: ui.space.lg }}>
        <AppText variant="display">{t('backup.import.title')}</AppText>

        {error ? <Card><AppText variant="body" color={colors.error}>{error}</AppText></Card> : null}
        {result ? (
          <Card style={{ gap: ui.space.xs }}>
            <AppText variant="headline" color={colors.primary}>
              {'restoredNoteCount' in result
                ? t('backup.import.replacementSuccess', { count: result.restoredNoteCount })
                : t('backup.import.success', { imported: result.importedCount - result.recoveredCount, recovered: result.recoveredCount, skipped: result.skippedCount })}
            </AppText>
            <AppText variant="body" color={result.recoveryComplete ? colors.primary : colors.error}>{recoveryRestrictionText(result)}</AppText>
          </Card>
        ) : null}

        {preview ? (
          <Card style={{ gap: ui.space.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: ui.space.sm }}>
              <View style={{ flex: 1 }}>
                <AppText variant="headline">{t('backup.import.preview')}</AppText>
                <AppText variant="bodySmall" color={colors.textSecondary}>{t('backup.import.selectedCount', { count: selectedNoteIds.size })}</AppText>
              </View>
              {state === 'committing' ? <ActivityIndicator color={colors.primary} /> : null}
            </View>
            {tree.map((folder) => renderFolder(folder))}
            <PrimaryButton disabled={selectedNoteIds.size === 0 || state !== 'idle'} onPress={() => void commit(false)}>
              {state === 'committing' ? t('backup.import.committing') : t('backup.import.selected', { count: selectedNoteIds.size })}
            </PrimaryButton>
            <PressableScale accessibilityRole="button" disabled={state !== 'idle'} onPress={() => void commit(true)} style={{ alignSelf: 'center', padding: ui.space.sm }}>
              <AppText variant="headline" color={colors.primary}>{t('backup.import.all', { count: preview.notes.length })}</AppText>
            </PressableScale>
            <View style={{ gap: ui.space.sm, borderTopWidth: 1, borderTopColor: colors.error, paddingTop: ui.space.lg }}>
              <AppText variant="headline" color={colors.error}>{t('backup.import.replacement')}</AppText>
              <PrimaryButton disabled={state !== 'idle'} onPress={confirmReplacement}>{t('backup.import.replacementAction')}</PrimaryButton>
            </View>
          </Card>
        ) : (
          <Card style={{ gap: ui.space.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: ui.space.sm }}>
              <AppText variant="headline">{t('backup.import.chooseArchive')}</AppText>
              <PressableScale accessibilityRole="button" disabled={state !== 'idle' || discovery.phase === 'loading'} onPress={() => void refreshBackupDiscovery()} style={{ padding: ui.space.sm }}>
                <AppText variant="headline" color={colors.primary}>{t('backup.collection.refresh')}</AppText>
              </PressableScale>
            </View>
            {discovery.value.scanError ? <AppText variant="body" color={colors.error}>{t('backup.collection.failed')}</AppText> : null}
            {archives.length === 0 && discovery.phase !== 'loading' ? <AppText variant="body" color={colors.textSecondary}>{t('backup.collection.empty')}</AppText> : null}
            {archives.map((archive) => {
              const selectable = archive.state === 'valid' || archive.state === 'uncertain';
              const color = archive.state === 'valid' ? colors.primary : archive.state === 'uncertain' ? colors.textSecondary : colors.error;
              return (
                <PressableScale key={archive.uri} accessibilityRole="button" disabled={!selectable || state !== 'idle'} onPress={() => void openPreview(archive.uri)} style={{ paddingVertical: ui.space.md, borderTopWidth: 1, borderTopColor: colors.border, gap: ui.space.xs }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: ui.space.sm }}>
                    <AppText variant="headline" style={{ flex: 1 }}>{formatDate(archive)}</AppText>
                    <AppText variant="bodySmall" color={color}>{t(`backup.collection.state.${archive.state}`)}</AppText>
                  </View>
                  <AppText variant="caption" color={colors.textSecondary} numberOfLines={1}>{archive.name}</AppText>
                </PressableScale>
              );
            })}
            <PressableScale accessibilityRole="button" disabled={state !== 'idle'} onPress={() => void openPreview()} style={{ alignSelf: 'center', padding: ui.space.sm }}>
              <AppText variant="headline" color={colors.primary}>{t('backup.import.chooseFile')}</AppText>
            </PressableScale>
          </Card>
        )}
      </ScrollView>
      <TopBar onBack={() => preview ? setPreview(null) : navigation.goBack()}>
        <LanguageToggleButton />
      </TopBar>
    </ScreenContainer>
  );
};
