import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../components/EmptyState';
import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { ScreenContainer } from '../components/ScreenContainer';
import {
  deleteNote,
  listNotesByFolder,
  moveNotePosition,
  type SortDirection,
  type SortField,
} from '../database/schema';
import { useLanguage } from '../i18n/LanguageContext';
import { getContrastColor } from '../theme/contrast';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { Note } from '../types/models';
import type { RootStackParamList } from '../types/navigation';
import type { RouteProp } from '@react-navigation/native';

type Route = RouteProp<RootStackParamList, 'NotesList'>;
type Navigation = NativeStackNavigationProp<RootStackParamList, 'NotesList'>;

export const NotesListScreen = () => {
  const route = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { colors } = useAppColors();
  const { t, language } = useLanguage();
  const insets = useSafeAreaInsets();
  const [notes, setNotes] = useState<Note[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('custom');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [isReorderMode, setIsReorderMode] = useState(false);
  const cardIconColor = getContrastColor(colors.card, colors.text, '#FFFFFF');
  const fabIconColor = getContrastColor(colors.primary, colors.text, '#FFFFFF');
  const fabBottom = Math.max(insets.bottom + 12, 22);
  const listBottomPadding = Math.max(insets.bottom + 104, 126);

  const { folderId, folderName } = route.params;

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

  useLayoutEffect(() => {
    navigation.setOptions({
      title: folderName,
      headerRight: () => <LanguageToggleButton />,
    });
  }, [folderName, navigation, language]);

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
            {t('notes.sortLabel')}
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
                    {isSearchActive ? t('sort.reorderSearchHint') : t('sort.reorderHint')}
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        </View>

        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('notes.searchPlaceholder')}
          placeholderTextColor={colors.textSecondary}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: ui.radius.md,
            backgroundColor: colors.card,
            color: colors.text,
            paddingHorizontal: 11,
            paddingVertical: 9,
            fontFamily: 'NotoSansBengali',
            fontSize: ui.font.md,
            marginBottom: ui.space.sm,
          }}
        />

        {isLoading ? (
          <EmptyState
            iconName="file-document-outline"
            title={t('common.loading')}
            subtitle={t('notes.loadingSubtitle')}
          />
        ) : filteredNotes.length === 0 ? (
          <EmptyState
            iconName="file-document-plus-outline"
            title={searchQuery.trim() ? t('notes.emptySearchTitle') : t('notes.emptyTitle')}
            subtitle={
              searchQuery.trim()
                ? t('notes.emptySearchSubtitle')
                : t('notes.emptySubtitle')
            }
          />
        ) : (
          <FlatList
            data={filteredNotes}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ paddingBottom: listBottomPadding, gap: 9 }}
            renderItem={({ item, index }) => (
              <Pressable
                onPress={() =>
                  navigation.navigate('NoteEditor', {
                    folderId,
                    folderName,
                    noteId: item.id,
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
                <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text
                      numberOfLines={2}
                      style={{
                        color: colors.text,
                        fontFamily: 'NotoSansBengali',
                        fontSize: ui.font.lg,
                        lineHeight: 21,
                      }}
                    >
                      {item.title}
                  </Text>
                  <Text
                    numberOfLines={2}
                      style={{
                        marginTop: 4,
                        color: colors.textSecondary,
                        fontFamily: 'NotoSansBengali',
                        fontSize: ui.font.sm,
                        lineHeight: 20,
                      }}
                    >
                      {item.content || t('common.noText')}
                  </Text>
                </View>
                <View style={{ alignItems: 'center', gap: 6 }}>
                  {sortField === 'custom' && isReorderMode ? (
                    <>
                      <Pressable
                        hitSlop={8}
                        disabled={!canReorder || index === 0}
                        onPress={(event) => {
                          event.stopPropagation();
                          void onMoveNote(item.id, 'up');
                        }}
                        style={{ opacity: !canReorder || index === 0 ? 0.4 : 1 }}
                      >
                        <MaterialCommunityIcons name="arrow-up-bold" size={19} color={cardIconColor} />
                      </Pressable>
                      <Pressable
                        hitSlop={8}
                        disabled={!canReorder || index === filteredNotes.length - 1}
                        onPress={(event) => {
                          event.stopPropagation();
                          void onMoveNote(item.id, 'down');
                        }}
                        style={{ opacity: !canReorder || index === filteredNotes.length - 1 ? 0.4 : 1 }}
                      >
                        <MaterialCommunityIcons name="arrow-down-bold" size={19} color={cardIconColor} />
                      </Pressable>
                    </>
                  ) : null}

                  {item.audioCount > 0 ? (
                    <MaterialCommunityIcons
                      name="microphone"
                      size={21}
                      color={cardIconColor}
                    />
                  ) : null}
                  <Pressable hitSlop={8} onPress={() => onDeleteNote(item)}>
                    <MaterialCommunityIcons
                      name="trash-can-outline"
                      size={21}
                      color={cardIconColor}
                    />
                  </Pressable>
                </View>
              </Pressable>
            )}
          />
        )}
      </View>

      <Pressable
        onPress={() =>
          navigation.navigate('NoteEditor', {
            folderId,
            folderName,
          })
        }
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
        <MaterialCommunityIcons name="plus" size={28} color={fabIconColor} />
      </Pressable>
    </ScreenContainer>
  );
};
