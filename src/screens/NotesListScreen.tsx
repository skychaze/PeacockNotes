import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { Alert, FlatList, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { AppText, getFontFamily } from '../components/AppText';
import { BottomSheet } from '../components/BottomSheet';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { FAB } from '../components/FAB';
import { IconButton } from '../components/IconButton';
import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { PressableScale } from '../components/PressableScale';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { SearchBar } from '../components/SearchBar';
import { TOP_BAR_HEIGHT, TopBar } from '../components/TopBar';
import { useEntrance } from '../components/entrance';
import {
  deleteNote,
  listNotesByFolder,
  moveNotePosition,
  updateNoteTitle,
  type SortDirection,
  type SortField,
} from '../database/schema';
import { useLanguage } from '../i18n/LanguageContext';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { NoteListItem } from '../types/models';
import type { RootStackParamList } from '../types/navigation';
import { formatMetaDate } from '../utils/dateFormat';
import type { RouteProp } from '@react-navigation/native';

type Route = RouteProp<RootStackParamList, 'NotesList'>;
type Navigation = NativeStackNavigationProp<RootStackParamList, 'NotesList'>;
type ActiveSheet = 'none' | 'sort' | 'rename';

const SORT_FIELDS: SortField[] = ['custom', 'name', 'createdAt'];

export const NotesListScreen = () => {
  const route = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { colors } = useAppColors();
  const { t, language } = useLanguage();
  const insets = useSafeAreaInsets();
  const entrance = useEntrance();
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchQueryForSearch, setSearchQueryForSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('custom');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>('none');
  const [selectedNoteIds, setSelectedNoteIds] = useState<ReadonlySet<number>>(new Set());
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const refreshRequestRef = useRef(0);
  const fabBottom = Math.max(insets.bottom + 12, 22);
  const listBottomPadding = Math.max(insets.bottom + 104, 126);

  const { folderId, folderName } = route.params;

  useEffect(() => {
    const timer = setTimeout(() => setSearchQueryForSearch(searchQuery), 150);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const closeSheet = useCallback(() => setActiveSheet('none'), []);

  const refreshNotes = useCallback(async () => {
    const requestId = refreshRequestRef.current + 1;
    refreshRequestRef.current = requestId;
    try {
      const result = await listNotesByFolder(
        folderId,
        { field: sortField, direction: sortDirection },
        searchQueryForSearch
      );
      if (requestId === refreshRequestRef.current) {
        setNotes(result);
      }
    } catch (error) {
      console.warn('Failed to load notes:', error);
      Alert.alert(t('common.error'), t('notes.loadError'));
    } finally {
      if (requestId === refreshRequestRef.current) {
        setIsLoading(false);
      }
    }
  }, [folderId, searchQueryForSearch, sortDirection, sortField, t]);

  useFocusEffect(
    useCallback(() => {
      void refreshNotes();
    }, [refreshNotes])
  );

  const onDeleteSelected = () => {
    const ids = [...selectedNoteIds];
    Alert.alert(t('notes.deleteTitle'), t('selection.deleteNotesBody', { count: ids.length }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            for (const id of ids) await deleteNote(id);
            setSelectedNoteIds(new Set());
            await refreshNotes();
          } catch (error) {
            console.warn('Failed to delete note:', error);
            Alert.alert(t('common.error'), t('notes.deleteError'));
          }
        },
      },
    ]);
  };

  const isSearchActive = searchQuery.trim().length > 0;
  const canReorder = sortField === 'custom' && isReorderMode && !isSearchActive;

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

  const onMoveNote = async (noteId: number, direction: 'up' | 'down') => {
    try {
      await moveNotePosition(folderId, noteId, direction);
      await refreshNotes();
    } catch (error) {
      console.warn('Failed to move note position:', error);
      Alert.alert(t('common.error'), t('notes.loadError'));
    }
  };

  const stopAnd =
    (action: () => void) =>
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      action();
    };

  const isSelecting = selectedNoteIds.size > 0;
  const toggleNote = (id: number) => setSelectedNoteIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const openRename = () => {
    const note = notes.find((item) => selectedNoteIds.has(item.id));
    if (!note) return;
    setRenameValue(note.title);
    setActiveSheet('rename');
  };
  const renameSelected = async () => {
    const id = [...selectedNoteIds][0];
    if (!renameValue.trim()) {
      Alert.alert(t('editor.missingTitleTitle'), t('editor.missingTitleBody'));
      return;
    }
    try {
      setIsRenaming(true);
      await updateNoteTitle(id, renameValue);
      setSelectedNoteIds(new Set());
      closeSheet();
      await refreshNotes();
    } catch (error) {
      console.warn('Failed to rename note:', error);
      Alert.alert(t('common.error'), t('notes.renameError'));
    } finally { setIsRenaming(false); }
  };

  return (
    <ScreenContainer>
      <View style={{ flex: 1, paddingHorizontal: ui.space.lg }}>
        <FlatList
          data={notes}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{
            paddingTop: insets.top + ui.space.sm + TOP_BAR_HEIGHT + ui.space.md,
            paddingBottom: listBottomPadding,
            gap: ui.space.md,
            flexGrow: 1,
          }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ gap: ui.space.md, marginBottom: ui.space.sm }}>
              <AppText variant="display" numberOfLines={2}>
                {folderName}
              </AppText>
              <SearchBar
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={t('notes.searchPlaceholder')}
              />
            </View>
          }
          ListEmptyComponent={
            isLoading ? (
              <EmptyState
                iconName="file-document-outline"
                title={t('common.loading')}
                subtitle={t('notes.loadingSubtitle')}
              />
            ) : isSearchActive ? (
              <EmptyState
                iconName="magnify"
                title={t('notes.emptySearchTitle')}
                subtitle={t('notes.emptySearchSubtitle')}
              />
            ) : (
              <EmptyState
                iconName="file-document-plus-outline"
                title={t('notes.emptyTitle')}
                subtitle={t('notes.emptySubtitle')}
              />
            )
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={entrance(index)}>
              <PressableScale
                accessibilityState={{ selected: selectedNoteIds.has(item.id) }}
                onPress={() => isSelecting ? toggleNote(item.id) :
                  navigation.navigate('NoteEditor', {
                    folderId,
                    folderName,
                    noteId: item.id,
                  })
                }
                onLongPress={() => toggleNote(item.id)}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: ui.radius.lg,
                  padding: ui.space.lg,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="headline" numberOfLines={2}>
                      {item.title}
                    </AppText>
                    <AppText
                      variant="bodySmall"
                      color={colors.textSecondary}
                      numberOfLines={2}
                      style={{ marginTop: ui.space.xs }}
                    >
                      {item.contentPreview || t('common.noText')}
                    </AppText>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: ui.space.md,
                        marginTop: ui.space.sm,
                      }}
                    >
                      <AppText variant="caption" color={colors.textSecondary}>
                        {formatMetaDate(item.updatedAt, language, t)}
                      </AppText>
                      {item.audioCount > 0 ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <MaterialCommunityIcons
                            name="microphone"
                            size={18}
                            color={colors.textSecondary}
                          />
                          <AppText variant="caption" color={colors.textSecondary}>
                            {item.audioCount}
                          </AppText>
                        </View>
                      ) : null}
                      {item.fileCount > 0 ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <MaterialCommunityIcons
                            name="paperclip"
                            size={18}
                            color={colors.textSecondary}
                          />
                          <AppText variant="caption" color={colors.textSecondary}>
                            {item.fileCount}
                          </AppText>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  {selectedNoteIds.has(item.id) ? <MaterialCommunityIcons name="checkbox-marked-circle" size={24} color={colors.primary} /> : null}

                  {sortField === 'custom' && isReorderMode ? (
                    <View style={{ flexDirection: 'row', gap: ui.space.xs }}>
                      <IconButton
                        icon="arrow-up-bold"
                        size={18}
                        disabled={!canReorder || index === 0}
                        onPress={stopAnd(() => void onMoveNote(item.id, 'up'))}
                      />
                      <IconButton
                        icon="arrow-down-bold"
                        size={18}
                        disabled={!canReorder || index === notes.length - 1}
                        onPress={stopAnd(() => void onMoveNote(item.id, 'down'))}
                      />
                    </View>
                  ) : null}
                </View>
              </PressableScale>
            </Animated.View>
          )}
        />
      </View>

      <TopBar onBack={() => navigation.goBack()}>
        {isSelecting ? <>
          <AppText variant="headline">{t('selection.count', { count: selectedNoteIds.size })}</AppText>
          <IconButton icon="close" accessibilityLabel={t('common.cancel')} onPress={() => setSelectedNoteIds(new Set())} />
          {selectedNoteIds.size === 1 ? <IconButton icon="pencil-outline" accessibilityLabel={t('action.rename')} onPress={openRename} /> : null}
          <IconButton icon="trash-can-outline" accessibilityLabel={t('common.delete')} onPress={onDeleteSelected} />
        </> : <><LanguageToggleButton />
        <IconButton
          icon="sort-variant"
          accessibilityLabel={t('sort.title')}
          onPress={() => setActiveSheet('sort')}
        /></>}
      </TopBar>

      {!isSelecting ? <FAB
        icon="plus"
        bottom={fabBottom}
        onPress={() =>
          navigation.navigate('NoteEditor', {
            folderId,
            folderName,
          })
        }
      /> : null}

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
                  {isSearchActive ? t('sort.reorderSearchHint') : t('sort.reorderHint')}
                </AppText>
              ) : null}
            </View>
          )}
        </View>
      </BottomSheet>

      <BottomSheet visible={activeSheet === 'rename'} onClose={closeSheet} title={t('notes.renameTitle')}>
        <View style={{ paddingHorizontal: ui.space.lg, gap: ui.space.md }}>
          <TextInput value={renameValue} onChangeText={setRenameValue} placeholder={t('editor.titlePlaceholder')} placeholderTextColor={colors.textSecondary} style={{ backgroundColor: colors.surfaceVariant, borderRadius: ui.radius.md, padding: 14, color: colors.text, fontFamily: getFontFamily(language, '400'), fontSize: ui.type.body.size }} />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: ui.space.sm }}>
            <PressableScale onPress={closeSheet} style={{ padding: ui.space.md }}><AppText variant="headline" color={colors.textSecondary}>{t('common.cancel')}</AppText></PressableScale>
            <View style={{ width: 132 }}><PrimaryButton onPress={() => void renameSelected()} disabled={isRenaming}>{t('common.save')}</PrimaryButton></View>
          </View>
        </View>
      </BottomSheet>
    </ScreenContainer>
  );
};
