import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { Alert, FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { ActionSheet } from '../components/ActionSheet';
import type { ActionSheetRow } from '../components/ActionSheet';
import { AppText } from '../components/AppText';
import { BottomSheet } from '../components/BottomSheet';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { FAB } from '../components/FAB';
import { IconButton } from '../components/IconButton';
import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { PressableScale } from '../components/PressableScale';
import { ScreenContainer } from '../components/ScreenContainer';
import { SearchBar } from '../components/SearchBar';
import { TOP_BAR_HEIGHT, TopBar } from '../components/TopBar';
import { useEntrance } from '../components/entrance';
import {
  deleteNote,
  listNotesByFolder,
  moveNotePosition,
  type SortDirection,
  type SortField,
} from '../database/schema';
import { useLanguage } from '../i18n/LanguageContext';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { Note } from '../types/models';
import type { RootStackParamList } from '../types/navigation';
import { formatMetaDate } from '../utils/dateFormat';
import type { RouteProp } from '@react-navigation/native';

type Route = RouteProp<RootStackParamList, 'NotesList'>;
type Navigation = NativeStackNavigationProp<RootStackParamList, 'NotesList'>;
type ActiveSheet = 'none' | 'sort' | 'noteActions';

const SORT_FIELDS: SortField[] = ['custom', 'name', 'createdAt'];

export const NotesListScreen = () => {
  const route = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { colors } = useAppColors();
  const { t, language } = useLanguage();
  const insets = useSafeAreaInsets();
  const entrance = useEntrance();
  const [notes, setNotes] = useState<Note[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('custom');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>('none');
  const [actionsNote, setActionsNote] = useState<Note | null>(null);
  const fabBottom = Math.max(insets.bottom + 12, 22);
  const listBottomPadding = Math.max(insets.bottom + 104, 126);

  const { folderId, folderName } = route.params;

  const closeSheet = useCallback(() => setActiveSheet('none'), []);

  const refreshNotes = useCallback(async () => {
    try {
      const result = await listNotesByFolder(folderId, { field: sortField, direction: sortDirection });
      setNotes(result);
    } catch (error) {
      console.warn('Failed to load notes:', error);
      Alert.alert(t('common.error'), t('notes.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [folderId, sortDirection, sortField, t]);

  useFocusEffect(
    useCallback(() => {
      void refreshNotes();
    }, [refreshNotes])
  );

  const onDeleteNote = (note: Note) => {
    Alert.alert(t('notes.deleteTitle'), t('notes.deleteBody', { title: note.title }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteNote(note.id);
            await refreshNotes();
          } catch (error) {
            console.warn('Failed to delete note:', error);
            Alert.alert(t('common.error'), t('notes.deleteError'));
          }
        },
      },
    ]);
  };

  const filteredNotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return notes;
    }

    return notes.filter((note) => {
      const title = note.title.toLowerCase();
      const content = note.content.toLowerCase();
      return title.includes(query) || content.includes(query);
    });
  }, [notes, searchQuery]);

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

  const actionRows: ActionSheetRow[] = actionsNote
    ? [
        {
          icon: 'trash-can-outline',
          label: t('common.delete'),
          destructive: true,
          onPress: () => onDeleteNote(actionsNote),
        },
      ]
    : [];

  return (
    <ScreenContainer>
      <View style={{ flex: 1, paddingHorizontal: ui.space.lg }}>
        <FlatList
          data={filteredNotes}
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
                onPress={() =>
                  navigation.navigate('NoteEditor', {
                    folderId,
                    folderName,
                    noteId: item.id,
                  })
                }
                onLongPress={() => {
                  setActionsNote(item);
                  setActiveSheet('noteActions');
                }}
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
                      {item.content || t('common.noText')}
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
                        disabled={!canReorder || index === filteredNotes.length - 1}
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
        <LanguageToggleButton />
        <IconButton
          icon="sort-variant"
          accessibilityLabel={t('sort.title')}
          onPress={() => setActiveSheet('sort')}
        />
      </TopBar>

      <FAB
        icon="plus"
        bottom={fabBottom}
        onPress={() =>
          navigation.navigate('NoteEditor', {
            folderId,
            folderName,
          })
        }
      />

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

      <ActionSheet
        visible={activeSheet === 'noteActions'}
        onClose={closeSheet}
        title={actionsNote?.title}
        rows={actionRows}
      />
    </ScreenContainer>
  );
};
