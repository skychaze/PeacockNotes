import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import {
  Alert,
  Animated,
  Easing,
  FlatList,
  Modal,
  Pressable,
  Text,
  useWindowDimensions,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../components/EmptyState';
import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import {
  createFolder,
  deleteFolder,
  listFolders,
  moveFolderPosition,
  updateFolderName,
  type SortDirection,
  type SortField,
} from '../database/schema';
import { useLanguage } from '../i18n/LanguageContext';
import { getContrastColor } from '../theme/contrast';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { FolderListItem } from '../types/models';
import type { RootStackParamList } from '../types/navigation';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'Folders'>;

export const FoldersScreen = () => {
  const navigation = useNavigation<Navigation>();
  const { colors } = useAppColors();
  const { t, language } = useLanguage();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const cardIconColor = getContrastColor(colors.card, colors.text, '#FFFFFF');
  const fabIconColor = getContrastColor(colors.primary, colors.text, '#FFFFFF');
  const menuIconColor = getContrastColor(colors.card, colors.text, '#FFFFFF');
  const [folders, setFolders] = useState<FolderListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameFolderName, setRenameFolderName] = useState('');
  const [renameFolderId, setRenameFolderId] = useState<number | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [sortField, setSortField] = useState<SortField>('custom');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [isSideMenuVisible, setIsSideMenuVisible] = useState(false);
  const sideMenuProgress = useRef(new Animated.Value(0)).current;

  const sideMenuWidth = Math.max(1, Math.floor(width * 0.4));
  const fabBottom = Math.max(insets.bottom + 12, 22);
  const listBottomPadding = Math.max(insets.bottom + 104, 126);

  const openSideMenu = useCallback(() => {
    setIsSideMenuVisible(true);
    Animated.timing(sideMenuProgress, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [sideMenuProgress]);

  const closeSideMenu = useCallback(
    (onDone?: () => void) => {
      Animated.timing(sideMenuProgress, {
        toValue: 0,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setIsSideMenuVisible(false);
          onDone?.();
        }
      });
    },
    [sideMenuProgress]
  );

  const drawerMenus = useMemo(
    () => [
      {
        id: 'storage',
        title: t('drawer.storage'),
        subtitle: t('drawer.storageSubtitle'),
        icon: 'harddisk',
        cardColor: '#FFF7D8',
        onPress: () => {
          closeSideMenu(() => navigation.navigate('StorageUsage'));
        },
      },
      {
        id: 'sync',
        title: t('drawer.cloudSync'),
        subtitle: t('drawer.comingSoon'),
        icon: 'cloud-outline',
        cardColor: '#E6F8FF',
        onPress: () => {
          closeSideMenu(() => Alert.alert(t('drawer.comingSoonTitle'), t('drawer.futureMessage')));
        },
      },
      {
        id: 'tags',
        title: t('drawer.tagsFilters'),
        subtitle: t('drawer.comingSoon'),
        icon: 'tag-multiple-outline',
        cardColor: '#FFE9F7',
        onPress: () => {
          closeSideMenu(() => Alert.alert(t('drawer.comingSoonTitle'), t('drawer.futureMessage')));
        },
      },
      {
        id: 'backup',
        title: t('drawer.backupRestore'),
        subtitle: t('drawer.comingSoon'),
        icon: 'backup-restore',
        cardColor: '#E9FDE7',
        onPress: () => {
          closeSideMenu(() => Alert.alert(t('drawer.comingSoonTitle'), t('drawer.futureMessage')));
        },
      },
    ],
    [closeSideMenu, navigation, t]
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t('header.folders'),
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 4 }}>
          <LanguageToggleButton />
          <Pressable
            onPress={openSideMenu}
            hitSlop={8}
            style={{
              marginLeft: 2,
              marginRight: 8,
              borderRadius: ui.radius.pill,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              paddingHorizontal: 8,
              paddingVertical: 6,
            }}
          >
            <MaterialCommunityIcons name="menu" size={18} color={menuIconColor} />
          </Pressable>
        </View>
      ),
    });
  }, [colors.border, colors.card, language, menuIconColor, navigation, openSideMenu, t]);

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
      setIsCreateOpen(false);
      await refreshFolders();
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
    setIsRenameOpen(true);
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
      setIsRenameOpen(false);
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

  return (
    <ScreenContainer>
      <View style={{ flex: 1, paddingHorizontal: ui.space.md, paddingTop: ui.space.sm }}>
        <View
          style={{
            marginBottom: ui.space.sm,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: ui.radius.lg,
            padding: ui.space.sm,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontFamily: 'NotoSansBengali',
              fontSize: ui.font.md,
              marginBottom: ui.space.xs,
            }}
          >
            {t('folder.sortLabel')}
          </Text>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={['custom', 'name', 'createdAt'] as SortField[]}
            keyExtractor={(item) => item}
            contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
            renderItem={({ item: field }) => {
              const isActive = sortField === field;
              return (
                <Pressable
                  onPress={() => onChangeSortField(field)}
                  style={{
                    paddingHorizontal: 11,
                    paddingVertical: 7,
                    borderRadius: ui.radius.pill,
                    borderWidth: 1,
                    borderColor: isActive ? colors.primary : colors.border,
                    backgroundColor: isActive ? colors.primary : colors.background,
                  }}
                >
                  <Text
                    style={{
                      color: isActive ? getContrastColor(colors.primary, colors.text, '#FFFFFF') : colors.text,
                      fontFamily: 'NotoSansBengali',
                      fontSize: ui.font.sm,
                    }}
                  >
                    {t(`sort.${field}`)}
                  </Text>
                </Pressable>
              );
            }}
          />

          <View style={{ marginTop: ui.space.xs }}>
            {sortField !== 'custom' ? (
              <Pressable
                onPress={() => setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                style={{
                  alignSelf: 'flex-start',
                  paddingHorizontal: 11,
                  paddingVertical: 7,
                  borderRadius: ui.radius.pill,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                }}
              >
                <Text style={{ color: colors.textSecondary, fontFamily: 'NotoSansBengali', fontSize: ui.font.sm }}>
                  {t(`sort.${sortDirection}`)}
                </Text>
              </Pressable>
            ) : (
              <View>
                <Pressable
                  onPress={() => setIsReorderMode((prev) => !prev)}
                  style={{
                    alignSelf: 'flex-start',
                    paddingHorizontal: 11,
                    paddingVertical: 7,
                    borderRadius: ui.radius.pill,
                    borderWidth: 1,
                    borderColor: isReorderMode ? colors.primary : colors.border,
                    backgroundColor: isReorderMode ? colors.primary : colors.background,
                  }}
                >
                  <Text
                    style={{
                      color: isReorderMode ? getContrastColor(colors.primary, colors.text, '#FFFFFF') : colors.text,
                      fontFamily: 'NotoSansBengali',
                      fontSize: ui.font.sm,
                    }}
                  >
                    {t('sort.reorder')}
                  </Text>
                </Pressable>
                {isReorderMode ? (
                  <Text
                    style={{
                      marginTop: ui.space.xs,
                      color: colors.textSecondary,
                      fontFamily: 'NotoSansBengali',
                      fontSize: ui.font.xs,
                    }}
                  >
                    {t('sort.reorderHint')}
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        </View>

        {isLoading ? (
          <EmptyState
            iconName="folder-clock-outline"
            title={t('common.loading')}
            subtitle={t('folder.loadingSubtitle')}
          />
        ) : folders.length === 0 ? (
          <EmptyState
            iconName="folder-outline"
            title={t('folder.emptyTitle')}
            subtitle={t('folder.emptySubtitle')}
          />
        ) : (
          <FlatList
            data={folders}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ paddingBottom: listBottomPadding, gap: 9 }}
            renderItem={({ item, index }) => (
              <Pressable
                onPress={() =>
                  navigation.navigate('NotesList', {
                    folderId: item.id,
                    folderName: item.name,
                  })
                }
                style={{
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderWidth: 1,
                  borderRadius: ui.radius.md,
                  paddingHorizontal: ui.space.sm,
                  paddingVertical: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <MaterialCommunityIcons
                    name="folder"
                    size={26}
                    color={cardIconColor}
                  />
                  <View style={{ marginLeft: 10, flex: 1 }}>
                    <Text
                      numberOfLines={2}
                      style={{
                        color: colors.text,
                        fontFamily: 'NotoSansBengali',
                        fontSize: ui.font.lg,
                        lineHeight: 21,
                      }}
                    >
                      {item.name}
                    </Text>
                    <Text
                      style={{
                        color: colors.textSecondary,
                        fontFamily: 'NotoSansBengali',
                        marginTop: 2,
                        fontSize: ui.font.sm,
                      }}
                    >
                      {t('folder.notesCount', { count: item.noteCount })}
                    </Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {sortField === 'custom' && isReorderMode ? (
                    <View style={{ marginRight: 4 }}>
                      <Pressable
                        disabled={index === 0}
                        hitSlop={8}
                        onPress={(event) => {
                          event.stopPropagation();
                          void onMoveFolder(item.id, 'up');
                        }}
                        style={{ padding: 5, opacity: index === 0 ? 0.4 : 1 }}
                      >
                        <MaterialCommunityIcons
                          name="arrow-up-bold"
                          size={19}
                          color={getContrastColor(colors.card, colors.textSecondary, '#FFFFFF')}
                        />
                      </Pressable>
                      <Pressable
                        disabled={index === folders.length - 1}
                        hitSlop={8}
                        onPress={(event) => {
                          event.stopPropagation();
                          void onMoveFolder(item.id, 'down');
                        }}
                        style={{ padding: 5, opacity: index === folders.length - 1 ? 0.4 : 1 }}
                      >
                        <MaterialCommunityIcons
                          name="arrow-down-bold"
                          size={19}
                          color={getContrastColor(colors.card, colors.textSecondary, '#FFFFFF')}
                        />
                      </Pressable>
                    </View>
                  ) : null}

                  <Pressable
                    hitSlop={10}
                    onPress={(event) => {
                      event.stopPropagation();
                      onOpenRenameFolder(item);
                    }}
                    style={{ padding: 7 }}
                  >
                    <MaterialCommunityIcons
                      name="pencil-outline"
                      size={21}
                      color={getContrastColor(colors.card, colors.textSecondary, '#FFFFFF')}
                    />
                  </Pressable>

                  <Pressable
                    hitSlop={10}
                    onPress={(event) => {
                      event.stopPropagation();
                      onDeleteFolder(item);
                    }}
                    style={{ padding: 7 }}
                  >
                    <MaterialCommunityIcons
                      name="trash-can-outline"
                      size={23}
                      color={getContrastColor(colors.card, colors.textSecondary, '#FFFFFF')}
                    />
                  </Pressable>
                </View>
              </Pressable>
            )}
          />
        )}
      </View>

      <Pressable
        onPress={() => setIsCreateOpen(true)}
        style={{
          position: 'absolute',
          right: 18,
          bottom: fabBottom,
          backgroundColor: colors.primary,
          width: 56,
          height: 56,
          borderRadius: 28,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000000',
          shadowOpacity: 0.18,
          shadowRadius: 9,
          shadowOffset: { width: 0, height: 4 },
          elevation: 8,
        }}
      >
        <MaterialCommunityIcons name="folder-plus" size={26} color={fabIconColor} />
      </Pressable>

      <Modal
        animationType="fade"
        transparent
        visible={isCreateOpen}
        onRequestClose={() => setIsCreateOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.35)',
            justifyContent: 'center',
            padding: ui.space.md,
          }}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: ui.radius.lg,
              borderWidth: 1,
              borderColor: colors.border,
              padding: ui.space.md,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: ui.font.xl,
                fontFamily: 'NotoSansBengali',
                marginBottom: ui.space.xs,
              }}
            >
              {t('folder.newTitle')}
            </Text>
            <TextInput
              value={newFolderName}
              onChangeText={setNewFolderName}
              placeholder={t('folder.placeholder')}
              placeholderTextColor={colors.textSecondary}
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.background,
                borderRadius: ui.radius.sm,
                color: colors.text,
                paddingHorizontal: 11,
                paddingVertical: 9,
                fontFamily: 'NotoSansBengali',
                fontSize: ui.font.md,
              }}
            />
            <View
              style={{
                marginTop: ui.space.sm,
                flexDirection: 'row',
                justifyContent: 'flex-end',
                gap: ui.space.sm,
              }}
            >
              <Pressable
                onPress={() => {
                  setIsCreateOpen(false);
                  setNewFolderName('');
                }}
                style={{ paddingHorizontal: 10, justifyContent: 'center' }}
              >
                <Text style={{ color: colors.textSecondary, fontFamily: 'NotoSansBengali', fontSize: ui.font.md }}>
                  {t('common.cancel')}
                </Text>
              </Pressable>
              <View style={{ width: 120 }}>
                <PrimaryButton onPress={onCreateFolder} disabled={isCreating}>
                  {isCreating ? t('folder.creating') : t('folder.create')}
                </PrimaryButton>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={isRenameOpen}
        onRequestClose={() => setIsRenameOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.35)',
            justifyContent: 'center',
            padding: ui.space.md,
          }}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: ui.radius.lg,
              borderWidth: 1,
              borderColor: colors.border,
              padding: ui.space.md,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: ui.font.xl,
                fontFamily: 'NotoSansBengali',
                marginBottom: ui.space.xs,
              }}
            >
              {t('folder.renameTitle')}
            </Text>
            <TextInput
              value={renameFolderName}
              onChangeText={setRenameFolderName}
              placeholder={t('folder.renamePlaceholder')}
              placeholderTextColor={colors.textSecondary}
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.background,
                borderRadius: ui.radius.sm,
                color: colors.text,
                paddingHorizontal: 11,
                paddingVertical: 9,
                fontFamily: 'NotoSansBengali',
                fontSize: ui.font.md,
              }}
            />
            <View
              style={{
                marginTop: ui.space.sm,
                flexDirection: 'row',
                justifyContent: 'flex-end',
                gap: ui.space.sm,
              }}
            >
              <Pressable
                onPress={() => {
                  setIsRenameOpen(false);
                  setRenameFolderName('');
                  setRenameFolderId(null);
                }}
                style={{ paddingHorizontal: 10, justifyContent: 'center' }}
              >
                <Text style={{ color: colors.textSecondary, fontFamily: 'NotoSansBengali', fontSize: ui.font.md }}>
                  {t('common.cancel')}
                </Text>
              </Pressable>
              <View style={{ width: 120 }}>
                <PrimaryButton onPress={onRenameFolder} disabled={isRenaming}>
                  {isRenaming ? t('folder.renaming') : t('common.save')}
                </PrimaryButton>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="none"
        transparent
        visible={isSideMenuVisible}
        onRequestClose={() => closeSideMenu()}
      >
        <View style={{ flex: 1 }}>
          <Pressable onPress={() => closeSideMenu()} style={{ flex: 1 }}>
            <Animated.View
              style={{
                flex: 1,
                backgroundColor: '#000000',
                opacity: sideMenuProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.3] }),
              }}
            />
          </Pressable>

          <Animated.View
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: sideMenuWidth,
              transform: [
                {
                  translateX: sideMenuProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [sideMenuWidth, 0],
                  }),
                },
              ],
            }}
          >
            <View
              style={{
                flex: 1,
                backgroundColor: '#FF7A59',
                paddingTop: 68,
                paddingHorizontal: 12,
                borderTopLeftRadius: 18,
                borderBottomLeftRadius: 18,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  position: 'absolute',
                  top: -40,
                  right: -35,
                  width: 148,
                  height: 148,
                  borderRadius: 74,
                  backgroundColor: '#FFD54F',
                  opacity: 0.65,
                }}
              />
              <View
                style={{
                  position: 'absolute',
                  bottom: 110,
                  left: -34,
                  width: 120,
                  height: 120,
                  borderRadius: 60,
                  backgroundColor: '#5EEAD4',
                  opacity: 0.5,
                }}
              />
              <Text
                style={{
                  color: '#FFFFFF',
                  fontFamily: 'NotoSansBengali',
                  fontSize: ui.font.xl,
                  marginBottom: 12,
                }}
              >
                {t('drawer.quickMenu')}
              </Text>

              <View style={{ gap: 9 }}>
                {drawerMenus.map((menu) => (
                  <Pressable
                    key={menu.id}
                    onPress={menu.onPress}
                    style={{
                      borderRadius: ui.radius.md,
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.35)',
                      backgroundColor: menu.cardColor,
                      paddingVertical: 10,
                      paddingHorizontal: 10,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <MaterialCommunityIcons
                      name={menu.icon as ComponentProps<typeof MaterialCommunityIcons>['name']}
                      size={20}
                      color={'#1C3144'}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#1C3144', fontFamily: 'NotoSansBengali', fontSize: ui.font.md }}>
                        {menu.title}
                      </Text>
                      <Text style={{ color: '#355164', fontFamily: 'NotoSansBengali', fontSize: ui.font.xs }}>
                        {menu.subtitle}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>

              <View style={{ marginTop: 'auto', paddingBottom: 20 }}>
                <Text
                  style={{
                    textAlign: 'center',
                    color: '#FFFFFF',
                    fontFamily: 'NotoSansBengali',
                    fontSize: ui.font.sm,
                  }}
                >
                  {t('drawer.madeWithLove')}
                </Text>
              </View>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </ScreenContainer>
  );
};
