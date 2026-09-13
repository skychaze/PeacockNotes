import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import {
  Alert,
  FlatList,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated from 'react-native-reanimated';
import { ActionSheet } from '../components/ActionSheet';
import type { ActionSheetRow } from '../components/ActionSheet';
import { AppText, getFontFamily } from '../components/AppText';
import { BottomSheet } from '../components/BottomSheet';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { FAB } from '../components/FAB';
import { GlassSurface } from '../components/GlassSurface';
import { IconButton } from '../components/IconButton';
import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { PressableScale } from '../components/PressableScale';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { TOP_BAR_HEIGHT, TopBar } from '../components/TopBar';
import { useEntrance } from '../components/entrance';
import {
  createFolder,
  deleteFolder,
  deleteFolders,
  getContentRevision,
  listFolders,
  moveFolderPosition,
  updateFolderName,
  type SortDirection,
  type SortField,
} from '../database/schema';
import { deriveHomeBackupStatus, type ArchivePresence, type HomeBackupStatus } from '../backup/homeBackupStatus';
import { getAutomaticBackupState, subscribeAutomaticBackupState } from '../services/automaticBackup';
import { getLastVerifiedBackup } from '../services/backupExport';
import {
  getBackupDiscoverySnapshot,
  initializeBackupDiscovery,
  refreshBackupDiscovery,
  subscribeBackupDiscovery,
  type BackupDiscoveryValue,
} from '../services/backupDiscovery';
import type { DiscoveryCacheSnapshot } from '../backup/discoveryCache';
import { useLanguage } from '../i18n/LanguageContext';
import { BACKUP_STATUS_PENDING, FOLDER_ACCENTS } from '../theme/colors';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { FolderListItem } from '../types/models';
import type { RootStackParamList } from '../types/navigation';
import { reconcileFolderSelection, toggleFolderSelection as toggleSelectedFolder } from '../utils/folderSelection';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'Folders'>;

type ActiveSheet = 'none' | 'sort' | 'menu' | 'create' | 'rename' | 'folderActions';

const SORT_FIELDS: SortField[] = ['custom', 'name', 'createdAt'];

const archivePresence = (
  snapshot: DiscoveryCacheSnapshot<BackupDiscoveryValue>,
  uri: string | undefined,
): ArchivePresence => {
  if (!uri) return 'missing';
  if (snapshot.phase !== 'ready' || !snapshot.value.collection?.complete) return 'unknown';
  return snapshot.value.collection.archives.some((archive) =>
    archive.uri === uri && archive.state === 'valid' && archive.verification === 'verified'
  ) ? 'present' : 'missing';
};

export const FoldersScreen = () => {
  const navigation = useNavigation<Navigation>();
  const { colors, isDark } = useAppColors();
  const { t, language } = useLanguage();
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const entrance = useEntrance();
  const cardWidth = (windowWidth - ui.space.lg * 2 - ui.space.md) / 2;

  const [folders, setFolders] = useState<FolderListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>('none');
  const [actionsFolder, setActionsFolder] = useState<FolderListItem | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [renameFolderName, setRenameFolderName] = useState('');
  const [renameFolderId, setRenameFolderId] = useState<number | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [sortField, setSortField] = useState<SortField>('custom');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedFolderIds, setSelectedFolderIds] = useState<ReadonlySet<number>>(new Set());
  const [backupStatus, setBackupStatus] = useState<HomeBackupStatus>({ level: 'pending', message: 'No verified backup yet' });

  const fabBottom = Math.max(insets.bottom + 12, 22);
  const listBottomPadding = Math.max(insets.bottom + 104, 126);

  const closeSheet = useCallback(() => setActiveSheet('none'), []);

  const menuRows: ActionSheetRow[] = useMemo(
    () => [
      {
        icon: 'harddisk',
        label: t('drawer.storage'),
        onPress: () => navigation.navigate('StorageUsage'),
      },
      {
        icon: 'backup-restore',
        label: t('drawer.backupRestore'),
        onPress: () => navigation.navigate('Backup'),
      },
    ],
    [navigation, t]
  );

  const refreshFolders = useCallback(async () => {
    try {
      const result = await listFolders({ field: sortField, direction: sortDirection });
      setFolders(result);
      setSelectedFolderIds((current) => reconcileFolderSelection(current, new Set(result.map((folder) => folder.id))));
    } catch (error) {
      console.warn('Failed to load folders:', error);
      Alert.alert(t('common.error'), t('folder.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [sortDirection, sortField, t]);

  const refreshBackupStatus = useCallback(async (snapshot = getBackupDiscoverySnapshot()) => {
    try {
      const [contentRevision, verifiedBackup, automatic] = await Promise.all([getContentRevision(), getLastVerifiedBackup(), getAutomaticBackupState()]);
      setBackupStatus(deriveHomeBackupStatus({
        contentRevision,
        verifiedBackup,
        automatic,
        destination: snapshot.value.folder,
        archivePresence: archivePresence(snapshot, verifiedBackup?.uri),
      }));
    } catch {
      setBackupStatus({ level: 'action_required', message: 'Backup status is unavailable' });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshFolders();
      void refreshBackupStatus();
      const unsubscribe = subscribeBackupDiscovery((snapshot) => void refreshBackupStatus(snapshot));
      const unsubscribeAutomatic = subscribeAutomaticBackupState(() => void refreshBackupStatus());
      void initializeBackupDiscovery();
      void refreshBackupDiscovery();
      const interval = setInterval(() => {
        void refreshBackupDiscovery();
        void refreshBackupStatus();
      }, 60_000);
      return () => { unsubscribe(); unsubscribeAutomatic(); clearInterval(interval); };
    }, [refreshBackupStatus, refreshFolders])
  );

  const toggleFolderSelection = (folderId: number) => setSelectedFolderIds((current) => toggleSelectedFolder(current, folderId));

  const exitSelectionMode = () => { setIsSelectionMode(false); setSelectedFolderIds(new Set()); };

  const confirmDeleteSelected = () => {
    const ids = [...selectedFolderIds];
    if (ids.length === 0) return;
    Alert.alert('Delete selected folders?', `${ids.length} selected folder${ids.length === 1 ? '' : 's'} and their notes will be deleted.`, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: async () => {
        try { await deleteFolders(ids); await refreshFolders(); await refreshBackupStatus(); exitSelectionMode(); }
        catch (error) { console.warn('Failed to delete selected folders:', error); Alert.alert(t('common.error'), t('folder.deleteError')); await refreshFolders(); await refreshBackupStatus(); }
      } },
    ]);
  };

  const onCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) {
      Alert.alert(t('folder.missingNameTitle'), t('folder.missingNameBody'));
      return;
    }

    try {
      setIsCreating(true);
      await createFolder(name);
      setNewFolderName('');
      closeSheet();
      await refreshFolders();
      await refreshBackupStatus();
    } catch (error) {
      console.warn('Failed to create folder:', error);
      Alert.alert(t('common.error'), t('folder.createError'));
    } finally {
      setIsCreating(false);
    }
  };

  const onDeleteFolder = (folder: FolderListItem) => {
    Alert.alert(
      t('folder.deleteConfirmTitle'),
      t('folder.deleteConfirmBody', { name: folder.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteFolder(folder.id);
              await refreshFolders();
              await refreshBackupStatus();
            } catch (error) {
              console.warn('Failed to delete folder:', error);
              Alert.alert(t('common.error'), t('folder.deleteError'));
            }
          },
        },
      ]
    );
  };

  const onOpenRenameFolder = (folder: FolderListItem) => {
    setRenameFolderId(folder.id);
    setRenameFolderName(folder.name);
    setActiveSheet('rename');
  };

  const onRenameFolder = async () => {
    const name = renameFolderName.trim();
    if (!name) {
      Alert.alert(t('folder.missingNameTitle'), t('folder.missingNameBody'));
      return;
    }
    if (!renameFolderId) {
      return;
    }

    try {
      setIsRenaming(true);
      await updateFolderName(renameFolderId, name);
      setRenameFolderId(null);
      setRenameFolderName('');
      closeSheet();
      await refreshFolders();
      await refreshBackupStatus();
    } catch (error) {
      console.warn('Failed to rename folder:', error);
      Alert.alert(t('common.error'), t('folder.renameError'));
    } finally {
      setIsRenaming(false);
    }
  };

  const onChangeSortField = (field: SortField) => {
    setSortField(field);
    if (field === 'custom') {
      setIsReorderMode(false);
      return;
    }
    if (field === 'name') {
      setSortDirection('asc');
      setIsReorderMode(false);
      return;
    }
    setSortDirection('desc');
    setIsReorderMode(false);
  };

  const onMoveFolder = async (folderId: number, direction: 'up' | 'down') => {
    try {
      await moveFolderPosition(folderId, direction);
      await refreshFolders();
      await refreshBackupStatus();
    } catch (error) {
      console.warn('Failed to move folder position:', error);
      Alert.alert(t('common.error'), t('folder.loadError'));
    }
  };

  const stopAnd =
    (action: () => void) =>
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      action();
    };

  const actionRows: ActionSheetRow[] = actionsFolder
    ? [
        {
          icon: 'pencil-outline',
          label: t('action.rename'),
          onPress: () => onOpenRenameFolder(actionsFolder),
        },
        {
          icon: 'trash-can-outline',
          label: t('common.delete'),
          destructive: true,
          onPress: () => onDeleteFolder(actionsFolder),
        },
      ]
    : [];

  return (
    <ScreenContainer>
      <View style={{ flex: 1, paddingHorizontal: ui.space.lg }}>
        <FlatList
          data={folders}
          keyExtractor={(item) => String(item.id)}
          numColumns={2}
          columnWrapperStyle={{ gap: ui.space.md }}
          contentContainerStyle={{
            paddingTop: insets.top + ui.space.sm + TOP_BAR_HEIGHT + ui.space.md,
            paddingBottom: listBottomPadding,
            gap: ui.space.md,
            flexGrow: 1,
          }}
          ListHeaderComponent={
            <AppText variant="display" style={{ marginBottom: ui.space.sm }}>
              {t('header.folders')}
            </AppText>
          }
          ListEmptyComponent={
            isLoading ? (
              <EmptyState
                iconName="folder-clock-outline"
                title={t('common.loading')}
                subtitle={t('folder.loadingSubtitle')}
              />
            ) : (
              <EmptyState
                iconName="folder-outline"
                title={t('folder.emptyTitle')}
                subtitle={t('folder.emptySubtitle')}
              />
            )
          }
          renderItem={({ item, index }) => {
            const accent = FOLDER_ACCENTS[Math.abs(Number(item.id)) % FOLDER_ACCENTS.length];
            const tint = isDark ? accent.dark : accent.light;
            const ink = isDark ? accent.inkDark : accent.inkLight;
            const isReorderModeActive = sortField === 'custom' && isReorderMode;

            return (
              <Animated.View
                entering={entrance(index)}
                style={{ width: cardWidth }}
              >
                <PressableScale
                  onPress={() => isSelectionMode ? toggleFolderSelection(item.id) : navigation.navigate('NotesList', { folderId: item.id, folderName: item.name })}
                  onLongPress={() => {
                    if (isSelectionMode) return;
                    setActionsFolder(item);
                    setActiveSheet('folderActions');
                  }}
                  style={{ flex: 1 }}
                >
                  <GlassSurface
                    radius={ui.radius.lg}
                    fallbackColor={tint}
                    style={{ flex: 1 }}
                    contentStyle={{ padding: ui.space.lg, gap: ui.space.sm, flex: 1 }}
                  >
                    <View
                      pointerEvents="none"
                      style={[
                        StyleSheet.absoluteFillObject,
                        { backgroundColor: tint, opacity: 0.28 },
                      ]}
                    />
                    <LinearGradient
                      pointerEvents="none"
                      colors={['rgba(255,255,255,0.12)', 'rgba(255,255,255,0)']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                      style={StyleSheet.absoluteFillObject}
                    />
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <MaterialCommunityIcons name="folder" size={24} color={ink} />
                      {isSelectionMode ? <MaterialCommunityIcons name={selectedFolderIds.has(item.id) ? 'checkbox-marked' : 'checkbox-blank-outline'} size={24} color={selectedFolderIds.has(item.id) ? colors.primary : ink} /> : null}
                      {isReorderModeActive ? (
                        <View style={{ flexDirection: 'row', gap: ui.space.xs }}>
                          <IconButton
                            icon="arrow-up-bold"
                            size={18}
                            disabled={index === 0}
                            onPress={stopAnd(() => void onMoveFolder(item.id, 'up'))}
                          />
                          <IconButton
                            icon="arrow-down-bold"
                            size={18}
                            disabled={index === folders.length - 1}
                            onPress={stopAnd(() => void onMoveFolder(item.id, 'down'))}
                          />
                        </View>
                      ) : null}
                    </View>
                    <AppText variant="headline" numberOfLines={2}>
                      {item.name}
                    </AppText>
                    <AppText variant="caption" color={ink} style={{ opacity: 0.8 }}>
                      {t('folder.notesCount', { count: item.noteCount })}
                    </AppText>
                  </GlassSurface>
                </PressableScale>
              </Animated.View>
            );
          }}
        />
      </View>

      <TopBar>
        <LanguageToggleButton />
        {isSelectionMode ? <>
          <AppText variant="caption">{selectedFolderIds.size} selected</AppText>
          <IconButton icon="trash-can-outline" danger disabled={selectedFolderIds.size === 0} accessibilityLabel="Delete selected folders" onPress={confirmDeleteSelected} />
          <IconButton icon="close" accessibilityLabel="Cancel selection" onPress={exitSelectionMode} />
        </> : <>
        <IconButton icon="checkbox-multiple-marked-outline" accessibilityLabel="Select folders" onPress={() => setIsSelectionMode(true)} />
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={backupStatus.message}
          onPress={() => Alert.alert('Backup status', backupStatus.message)}
          style={{ width: 40, height: 40, borderRadius: ui.radius.pill, backgroundColor: colors.surfaceVariant, alignItems: 'center', justifyContent: 'center' }}
        >
          <MaterialCommunityIcons
            name="cloud-check-outline"
            size={22}
            color={backupStatus.level === 'current' ? colors.primary : backupStatus.level === 'pending' ? (isDark ? BACKUP_STATUS_PENDING.dark : BACKUP_STATUS_PENDING.light) : colors.error}
          />
        </PressableScale>
        <IconButton
          icon="sort-variant"
          accessibilityLabel={t('sort.title')}
          onPress={() => setActiveSheet('sort')}
        />
        <View style={{ width: ui.space.sm }} />
        <IconButton
          icon="dots-vertical"
          accessibilityLabel={t('drawer.quickMenu')}
          onPress={() => setActiveSheet('menu')}
        />
        </>}
      </TopBar>

      {!isSelectionMode ? <FAB icon="folder-plus" bottom={fabBottom} onPress={() => setActiveSheet('create')} /> : null}

      <BottomSheet
        visible={activeSheet === 'sort'}
        onClose={closeSheet}
        title={t('sort.title')}
      >
        <View style={{ paddingHorizontal: ui.space.lg, gap: ui.space.md }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ui.space.sm }}>
            {SORT_FIELDS.map((field) => (
              <Chip
                key={field}
                label={t(`sort.${field}`)}
                selected={sortField === field}
                onPress={() => onChangeSortField(field)}
              />
            ))}
          </View>

          {sortField !== 'custom' ? (
            <View style={{ flexDirection: 'row', gap: ui.space.sm }}>
              <Chip
                label={t('sort.asc')}
                selected={sortDirection === 'asc'}
                onPress={() => setSortDirection('asc')}
              />
              <Chip
                label={t('sort.desc')}
                selected={sortDirection === 'desc'}
                onPress={() => setSortDirection('desc')}
              />
            </View>
          ) : (
            <View style={{ gap: ui.space.sm }}>
              <Chip
                label={t('sort.reorder')}
                selected={isReorderMode}
                onPress={() => setIsReorderMode((prev) => !prev)}
              />
              {isReorderMode ? (
                <AppText variant="caption" color={colors.textSecondary}>
                  {t('sort.reorderHint')}
                </AppText>
              ) : null}
            </View>
          )}
        </View>
      </BottomSheet>

      <ActionSheet
        visible={activeSheet === 'menu'}
        onClose={closeSheet}
        title={t('drawer.quickMenu')}
        rows={menuRows}
      />

      <ActionSheet
        visible={activeSheet === 'folderActions'}
        onClose={closeSheet}
        title={actionsFolder?.name}
        rows={actionRows}
      />

      <BottomSheet
        visible={activeSheet === 'create'}
        onClose={closeSheet}
        title={t('folder.newTitle')}
      >
        <View style={{ paddingHorizontal: ui.space.lg, gap: ui.space.md }}>
          <TextInput
            value={newFolderName}
            onChangeText={setNewFolderName}
            placeholder={t('folder.placeholder')}
            placeholderTextColor={colors.textSecondary}
            style={{
              backgroundColor: colors.surfaceVariant,
              borderRadius: ui.radius.md,
              padding: 14,
              color: colors.text,
              fontFamily: getFontFamily(language, '400'),
              fontSize: ui.type.body.size,
            }}
          />
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: ui.space.sm,
            }}
          >
            <PressableScale
              onPress={() => {
                setNewFolderName('');
                closeSheet();
              }}
              style={{ paddingHorizontal: ui.space.md, paddingVertical: ui.space.md }}
            >
              <AppText variant="headline" color={colors.textSecondary}>
                {t('common.cancel')}
              </AppText>
            </PressableScale>
            <View style={{ width: 132 }}>
              <PrimaryButton onPress={onCreateFolder} disabled={isCreating}>
                {isCreating ? t('folder.creating') : t('folder.create')}
              </PrimaryButton>
            </View>
          </View>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={activeSheet === 'rename'}
        onClose={closeSheet}
        title={t('folder.renameTitle')}
      >
        <View style={{ paddingHorizontal: ui.space.lg, gap: ui.space.md }}>
          <TextInput
            value={renameFolderName}
            onChangeText={setRenameFolderName}
            placeholder={t('folder.renamePlaceholder')}
            placeholderTextColor={colors.textSecondary}
            style={{
              backgroundColor: colors.surfaceVariant,
              borderRadius: ui.radius.md,
              padding: 14,
              color: colors.text,
              fontFamily: getFontFamily(language, '400'),
              fontSize: ui.type.body.size,
            }}
          />
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: ui.space.sm,
            }}
          >
            <PressableScale
              onPress={() => {
                setRenameFolderName('');
                setRenameFolderId(null);
                closeSheet();
              }}
              style={{ paddingHorizontal: ui.space.md, paddingVertical: ui.space.md }}
            >
              <AppText variant="headline" color={colors.textSecondary}>
                {t('common.cancel')}
              </AppText>
            </PressableScale>
            <View style={{ width: 132 }}>
              <PrimaryButton onPress={onRenameFolder} disabled={isRenaming}>
                {isRenaming ? t('folder.renaming') : t('common.save')}
              </PrimaryButton>
            </View>
          </View>
        </View>
      </BottomSheet>
    </ScreenContainer>
  );
};
