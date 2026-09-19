import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import {
  Alert,
  BackHandler,
  FlatList,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn } from 'react-native-reanimated';
import { AppText, getFontFamily } from '../components/AppText';
import { AppUpdateIndicator } from '../components/AppUpdateIndicator';
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
  listFolders,
  moveFolderPosition,
  updateFolderName,
  type SortDirection,
  type SortField,
} from '../database/schema';
import { getBackupDiscoverySnapshot, initializeBackupDiscovery, subscribeBackupDiscovery } from '../services/backupDiscovery';
import { getAppUpdateSnapshot, hasAppUpdate, subscribeAppUpdate } from '../services/appUpdate';
import { useLanguage } from '../i18n/LanguageContext';
import { FOLDER_ACCENTS } from '../theme/colors';
import { useQuality } from '../theme/quality';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { FolderListItem } from '../types/models';
import type { RootStackParamList } from '../types/navigation';
import { formatBackupDate } from '../utils/backupDate';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'Folders'>;

type ActiveSheet = 'none' | 'menu' | 'create' | 'rename' | 'backupInfo';
type FolderViewMode = 'grid' | 'list';

const SORT_FIELDS: SortField[] = ['custom', 'name', 'createdAt'];
const FOLDER_VIEW_MODE_KEY = '@peacock-notes/folder-view-mode';

export const FoldersScreen = () => {
  const navigation = useNavigation<Navigation>();
  const { colors, isDark, toggleTheme } = useAppColors();
  const { motionEnabled } = useQuality();
  const { t, language } = useLanguage();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const entrance = useEntrance();
  const cardWidth = (windowWidth - ui.space.lg * 2 - ui.space.md) / 2;

  const [folders, setFolders] = useState<FolderListItem[]>([]);
  const [backupDiscovery, setBackupDiscovery] = useState(getBackupDiscoverySnapshot());
  const [appUpdate, setAppUpdate] = useState(getAppUpdateSnapshot());
  const [isLoading, setIsLoading] = useState(true);
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>('none');
  const [selectedFolderIds, setSelectedFolderIds] = useState<ReadonlySet<number>>(new Set());
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [renameFolderName, setRenameFolderName] = useState('');
  const [renameFolderId, setRenameFolderId] = useState<number | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [sortField, setSortField] = useState<SortField>('custom');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [viewMode, setViewMode] = useState<FolderViewMode>('grid');

  const fabBottom = Math.max(insets.bottom + 12, 22);
  const listBottomPadding = Math.max(insets.bottom + 104, 126);
  const appVersion = Constants.expoConfig?.version;
  const hasUpdate = hasAppUpdate(appUpdate);
  const availableVersion = hasUpdate ? appUpdate.release?.versionName : null;
  const showUpdateIndicator = appUpdate.phase === 'downloading' || appUpdate.phase === 'ready';

  const closeSheet = useCallback(() => setActiveSheet('none'), []);
  const isSelecting = selectedFolderIds.size > 0;
  const openAppUpdate = () => navigation.navigate('AppUpdate');

  const menuRows = useMemo<Array<{
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    label: string;
    onPress: () => void;
  }>>(
    () => [
      {
        icon: 'harddisk',
        label: t('drawer.storage'),
        onPress: () => {
          closeSheet();
          navigation.navigate('StorageUsage');
        },
      },
      {
        icon: 'backup-restore',
        label: t('drawer.backupRestore'),
        onPress: () => {
          closeSheet();
          navigation.navigate('Backup');
        },
      },
      {
        icon: 'cellphone-arrow-down',
        label: t('drawer.updates'),
        onPress: () => {
          closeSheet();
          navigation.navigate('AppUpdate');
        },
      },
    ],
    [closeSheet, navigation, t]
  );

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(FOLDER_VIEW_MODE_KEY).then((storedMode) => {
      if (cancelled || (storedMode !== 'grid' && storedMode !== 'list')) return;
      setViewMode(storedMode);
    });
    return () => { cancelled = true; };
  }, []);

  const changeViewMode = (nextMode: FolderViewMode) => {
    setViewMode(nextMode);
    void AsyncStorage.setItem(FOLDER_VIEW_MODE_KEY, nextMode);
  };

  const refreshFolders = useCallback(async () => {
    try {
      const result = await listFolders({ field: sortField, direction: sortDirection });
      setFolders(result);
    } catch (error) {
      console.warn('Failed to load folders:', error);
      Alert.alert(t('common.error'), t('folder.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [sortDirection, sortField, t]);

  useFocusEffect(
    useCallback(() => {
      void refreshFolders();
    }, [refreshFolders])
  );
  useFocusEffect(useCallback(() => {
    setBackupDiscovery(getBackupDiscoverySnapshot());
    return subscribeBackupDiscovery(setBackupDiscovery);
  }, []));
  useFocusEffect(useCallback(() => {
    setAppUpdate(getAppUpdateSnapshot());
    return subscribeAppUpdate(setAppUpdate);
  }, []));
  useFocusEffect(useCallback(() => () => setActiveSheet('none'), []));

  const openBackupInfo = async () => {
    setBackupDiscovery(getBackupDiscoverySnapshot());
    setActiveSheet('backupInfo');
    try {
      await initializeBackupDiscovery();
    } catch (error) {
      console.warn('Failed to load backup summary:', error);
    } finally {
      setBackupDiscovery(getBackupDiscoverySnapshot());
    }
  };

  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedFolderIds.size > 0) {
        setSelectedFolderIds(new Set());
        return true;
      }
      BackHandler.exitApp();
      return true;
    });
    return () => subscription.remove();
  }, [selectedFolderIds.size]));

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
    } catch (error) {
      console.warn('Failed to create folder:', error);
      Alert.alert(t('common.error'), t('folder.createError'));
    } finally {
      setIsCreating(false);
    }
  };

  const onDeleteSelected = () => {
    const ids = [...selectedFolderIds];
    Alert.alert(
      t('folder.deleteConfirmTitle'),
      t('selection.deleteFoldersBody', { count: ids.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              for (const id of ids) await deleteFolder(id);
              setSelectedFolderIds(new Set());
              await refreshFolders();
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

  const toggleFolder = (id: number) => setSelectedFolderIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const openSelectedRename = () => {
    const id = [...selectedFolderIds][0];
    const folder = folders.find((item) => item.id === id);
    if (folder) onOpenRenameFolder(folder);
  };

  const newestBackup = backupDiscovery.value.collection?.complete
    ? [...backupDiscovery.value.collection.archives]
      .filter((archive) => archive.state === 'valid')
      .sort((left, right) => (Date.parse(right.createdAt ?? '') || right.providerModifiedAt || 0) - (Date.parse(left.createdAt ?? '') || left.providerModifiedAt || 0))[0]
    : null;

  return (
    <ScreenContainer>
      <View style={{ flex: 1, paddingHorizontal: ui.space.lg }}>
        <FlatList
          key={viewMode}
          data={folders}
          keyExtractor={(item) => String(item.id)}
          numColumns={viewMode === 'grid' ? 2 : 1}
          columnWrapperStyle={viewMode === 'grid' ? { gap: ui.space.md } : undefined}
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
                style={{ width: viewMode === 'grid' ? cardWidth : '100%' }}
              >
                <PressableScale
                  accessibilityState={{ selected: selectedFolderIds.has(item.id) }}
                  onPress={() => {
                    if (isSelecting) {
                      toggleFolder(item.id);
                      return;
                    }
                    closeSheet();
                    navigation.navigate('NotesList', {
                      folderId: item.id,
                      folderName: item.name,
                    });
                  }}
                  onLongPress={() => toggleFolder(item.id)}
                  style={{ flex: 1 }}
                >
                    <GlassSurface
                      radius={ui.radius.lg}
                      fallbackColor={tint}
                      style={{ flex: 1 }}
                      contentStyle={{
                        padding: viewMode === 'list' ? ui.space.md : ui.space.lg,
                        gap: ui.space.sm,
                        flex: 1,
                      }}
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
                    {viewMode === 'list' ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ui.space.md }}>
                        <MaterialCommunityIcons name="folder" size={24} color={ink} />
                        <View style={{ flex: 1, gap: ui.space.xs }}>
                          <AppText variant="headline" numberOfLines={1}>
                            {item.name}
                          </AppText>
                          <AppText variant="caption" color={ink} style={{ opacity: 0.8 }}>
                            {t('folder.notesCount', { count: item.noteCount })}
                          </AppText>
                        </View>
                        {selectedFolderIds.has(item.id) ? <MaterialCommunityIcons name="checkbox-marked-circle" size={24} color={colors.primary} /> : null}
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
                    ) : (
                      <>
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <MaterialCommunityIcons name="folder" size={24} color={ink} />
                          {selectedFolderIds.has(item.id) ? <MaterialCommunityIcons name="checkbox-marked-circle" size={24} color={colors.primary} /> : null}
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
                      </>
                    )}
                  </GlassSurface>
                </PressableScale>
              </Animated.View>
            );
          }}
        />
      </View>

      <TopBar leading={appVersion ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: ui.space.sm }}>
          <View style={{ gap: ui.space.xs }}>
            <AppText variant="caption" color={colors.textSecondary} style={{ opacity: 0.7 }}>
              v{appVersion}
            </AppText>
            {availableVersion ? (
              <Animated.View entering={motionEnabled ? FadeIn.duration(160) : undefined}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: ui.space.xs }}>
                  <View
                    accessible={false}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: ui.radius.pill,
                      backgroundColor: colors.primary,
                    }}
                  />
                  <AppText variant="caption" color={colors.primary}>
                    v{availableVersion}
                  </AppText>
                </View>
              </Animated.View>
            ) : null}
          </View>
          {showUpdateIndicator ? (
            <AppUpdateIndicator
              phase={appUpdate.phase}
              progress={appUpdate.progress}
              versionName={appUpdate.release?.versionName ?? null}
              onPress={openAppUpdate}
            />
          ) : null}
        </View>
      ) : null}>
        {isSelecting ? <>
          <AppText variant="headline">{t('selection.count', { count: selectedFolderIds.size })}</AppText>
          <IconButton icon="close" accessibilityLabel={t('common.cancel')} onPress={() => setSelectedFolderIds(new Set())} />
          {selectedFolderIds.size === 1 ? <IconButton icon="pencil-outline" accessibilityLabel={t('action.rename')} onPress={openSelectedRename} /> : null}
          <IconButton icon="trash-can-outline" accessibilityLabel={t('common.delete')} onPress={onDeleteSelected} />
        </> : <>
          <LanguageToggleButton />
          <IconButton icon={isDark ? 'weather-sunny' : 'weather-night'} accessibilityLabel={isDark ? t('theme.useLight') : t('theme.useDark')} accessibilityState={{ checked: isDark }} onPress={toggleTheme} />
          <IconButton icon="information-outline" accessibilityLabel={t('home.backupInfo')} onPress={() => void openBackupInfo()} />
          <IconButton icon="dots-vertical" accessibilityLabel={t('drawer.quickMenu')} onPress={() => setActiveSheet('menu')} />
        </>}
      </TopBar>

      {!isSelecting ? <FAB icon="folder-plus" bottom={fabBottom} onPress={() => setActiveSheet('create')} /> : null}

      <BottomSheet visible={activeSheet === 'menu'} onClose={closeSheet} title={t('drawer.quickMenu')}>
        <ScrollView
          style={{ height: Math.min(windowHeight * 0.56, 500) }}
          contentContainerStyle={{ gap: ui.space.md, paddingBottom: ui.space.md }}
          showsVerticalScrollIndicator={false}
        >
          <AppText variant="headline" style={{ paddingHorizontal: ui.space.lg }}>
            {t('sort.title')}
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ui.space.sm, paddingHorizontal: ui.space.lg }}>
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
            <View style={{ flexDirection: 'row', gap: ui.space.sm, paddingHorizontal: ui.space.lg }}>
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
            <View style={{ gap: ui.space.sm, paddingHorizontal: ui.space.lg }}>
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

          <AppText variant="headline" style={{ paddingHorizontal: ui.space.lg, marginTop: ui.space.sm }}>
            {t('folder.viewTitle')}
          </AppText>
          <View style={{ flexDirection: 'row', gap: ui.space.sm, paddingHorizontal: ui.space.lg }}>
            <Chip
              label={t('folder.viewGrid')}
              selected={viewMode === 'grid'}
              onPress={() => changeViewMode('grid')}
            />
            <Chip
              label={t('folder.viewList')}
              selected={viewMode === 'list'}
              onPress={() => changeViewMode('list')}
            />
          </View>

          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: ui.space.sm }}>
            {menuRows.map((row) => (
              <PressableScale
                key={row.label}
                onPress={row.onPress}
                android_ripple={{ color: colors.surfaceVariant }}
                style={{
                  height: 52,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: ui.space.md,
                  paddingHorizontal: ui.space.lg,
                }}
              >
                <MaterialCommunityIcons name={row.icon} size={22} color={colors.textSecondary} />
                <AppText variant="headline">{row.label}</AppText>
              </PressableScale>
            ))}
          </View>
        </ScrollView>
      </BottomSheet>

      <BottomSheet visible={activeSheet === 'backupInfo'} onClose={closeSheet} title={t('home.backupInfo')}>
        <View style={{ paddingHorizontal: ui.space.lg }}>
          <AppText variant="body">{newestBackup
            ? formatBackupDate(newestBackup.createdAt ?? newestBackup.providerModifiedAt ?? 0, language) ?? t('home.noBackup')
            : t('home.noBackup')}</AppText>
        </View>
      </BottomSheet>

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
