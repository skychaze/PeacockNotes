import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { useShareIntent, type ShareIntentFile } from 'expo-share-intent';
import * as FileSystem from 'expo-file-system/legacy';
import { appendAudiosToNote, listFolders, listNotesByFolder } from '../database/schema';
import { ScreenContainer } from '../components/ScreenContainer';
import { EmptyState } from '../components/EmptyState';
import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { useLanguage } from '../i18n/LanguageContext';
import { getContrastColor } from '../theme/contrast';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { FolderListItem, Note, NoteAudioDraft } from '../types/models';
import type { RootStackParamList } from '../types/navigation';
import {
  getBestAudioExtension,
  isProbablyAudioSource,
} from '../utils/audioFormat';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'ShareImport'>;
type Route = RouteProp<RootStackParamList, 'ShareImport'>;

export const ShareImportScreen = () => {
  const route = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { colors } = useAppColors();
  const { t, language } = useLanguage();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const selectedFolderTextColor = getContrastColor(colors.primary, '#0B1320', '#FFFFFF');

  const [folders, setFolders] = useState<FolderListItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [hasAutoRedirected, setHasAutoRedirected] = useState(false);
  const [pendingSharedFiles, setPendingSharedFiles] = useState<
    Array<{ path: string; fileName: string; mimeType: string }>
  >([]);

  const routeSharedFiles = useMemo(() => {
    return (route.params?.sharedFiles ?? []).filter((file) =>
      isProbablyAudioSource(file.mimeType, file.fileName, file.path)
    );
  }, [route.params?.sharedFiles]);

  const sharedAudioFiles = useMemo(() => {
    const files = shareIntent.files ?? [];
    return files
      .map((file: ShareIntentFile) => ({
        path: file.path,
        fileName: file.fileName,
        mimeType: file.mimeType,
      }))
      .filter((file) => isProbablyAudioSource(file.mimeType, file.fileName, file.path));
  }, [shareIntent.files]);

  useEffect(() => {
    if (routeSharedFiles.length > 0) {
      setPendingSharedFiles(routeSharedFiles);
      return;
    }

    if (sharedAudioFiles.length > 0) {
      setPendingSharedFiles(sharedAudioFiles);
    }
  }, [routeSharedFiles, sharedAudioFiles]);

  const refreshFolders = useCallback(async () => {
    try {
      const result = await listFolders();
      setFolders(result);
      if (!selectedFolderId && result.length > 0) {
        setSelectedFolderId(result[0].id);
      }
    } catch (error) {
      console.warn('Failed to load folders for share import:', error);
      Alert.alert(t('common.error'), t('shareImport.folderLoadError'));
    } finally {
      setIsLoading(false);
    }
  }, [selectedFolderId, t, language]);

  useEffect(() => {
    void refreshFolders();
  }, [refreshFolders]);

  useEffect(() => {
    const loadNotes = async () => {
      if (!selectedFolderId) {
        setNotes([]);
        return;
      }
      try {
        const result = await listNotesByFolder(selectedFolderId);
        setNotes(result);
      } catch (error) {
        console.warn('Failed to load notes for share import:', error);
        Alert.alert(t('common.error'), t('shareImport.noteLoadError'));
      }
    };

    void loadNotes();
  }, [selectedFolderId]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t('header.shareImport'),
      headerRight: () => <LanguageToggleButton />,
    });
  }, [navigation, t, language]);

  useEffect(() => {
    if (hasAutoRedirected) {
      return;
    }

    if (
      routeSharedFiles.length > 0 ||
      sharedAudioFiles.length > 0 ||
      pendingSharedFiles.length > 0
    ) {
      return;
    }

    if (!hasShareIntent) {
      setHasAutoRedirected(true);
      navigation.reset({
        index: 0,
        routes: [{ name: 'Folders' }],
      });
    }
  }, [
    hasAutoRedirected,
    hasShareIntent,
    navigation,
    pendingSharedFiles.length,
    routeSharedFiles.length,
    sharedAudioFiles.length,
  ]);

  const buildAudioDrafts = async (): Promise<NoteAudioDraft[]> => {
    const documentDirectory = FileSystem.documentDirectory;
    if (!documentDirectory) {
      throw new Error('Document directory unavailable');
    }
    const audioDir = `${documentDirectory}audio`;
    const dirInfo = await FileSystem.getInfoAsync(audioDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(audioDir, { intermediates: true });
    }

    const drafts: NoteAudioDraft[] = [];
    for (const [index, file] of pendingSharedFiles.entries()) {
      const extension = getBestAudioExtension(file.mimeType, file.fileName, file.path);
      const fileName = file.fileName?.trim() || t('shareImport.sharedAudioDefault', { index: index + 1 });
      const targetPath = `${audioDir}/${Date.now()}_${index + 1}_shared.${extension}`;
      try {
        await FileSystem.copyAsync({ from: file.path, to: targetPath });
      } catch (copyError) {
        const detailed = copyError instanceof Error ? copyError.message : String(copyError);
        throw new Error(`Audio copy failed for ${fileName}: ${detailed}`);
      }
      drafts.push({
        uri: targetPath,
        displayName: fileName,
      });
    }

    return drafts;
  };

  const onAppendToNote = async (note: Note) => {
    if (isImporting) {
      return;
    }

    try {
      setIsImporting(true);
      const drafts = await buildAudioDrafts();
      await appendAudiosToNote(note.id, drafts);
      resetShareIntent();
      setPendingSharedFiles([]);
      Alert.alert(
        t('shareImport.importedTitle'),
        t('shareImport.importedBody', { count: drafts.length, title: note.title })
      );
      navigation.navigate('NotesList', {
        folderId: note.folderId,
        folderName: folders.find((folder) => folder.id === note.folderId)?.name ?? t('header.notes'),
      });
    } catch (error) {
      console.warn('Failed to append shared audios:', error);
      const detailed = error instanceof Error ? error.message : String(error);
      Alert.alert(t('common.error'), `${t('shareImport.appendError')}\n${detailed}`);
    } finally {
      setIsImporting(false);
    }
  };

  if (pendingSharedFiles.length === 0) {
    return (
      <ScreenContainer>
        <EmptyState
          iconName="share-variant-outline"
          title={t('shareImport.noShareTitle')}
          subtitle={t('shareImport.noShareBody')}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View style={{ flex: 1, paddingHorizontal: ui.space.md, paddingTop: ui.space.sm, gap: 10 }}>
        <Text style={{ color: colors.text, fontFamily: 'NotoSansBengali', fontSize: ui.font.lg }}>
          {t('shareImport.selectFolder')}
        </Text>

        <FlatList
          horizontal
          data={folders}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ gap: 8, paddingBottom: 3 }}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => {
            const isSelected = selectedFolderId === item.id;
            return (
              <Pressable
                onPress={() => setSelectedFolderId(item.id)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: ui.radius.pill,
                  borderWidth: 1,
                  borderColor: isSelected ? colors.primary : colors.border,
                  backgroundColor: isSelected ? colors.primary : colors.background,
                }}
              >
                <Text
                  style={{
                    color: isSelected ? selectedFolderTextColor : colors.text,
                    fontFamily: 'NotoSansBengali',
                    fontSize: ui.font.sm,
                  }}
                >
                  {item.name}
                </Text>
              </Pressable>
            );
          }}
        />

        <Text style={{ color: colors.text, fontFamily: 'NotoSansBengali', fontSize: ui.font.lg, marginTop: 6 }}>
          {t('shareImport.selectNote')}
        </Text>

        {isLoading ? (
          <EmptyState
            iconName="folder-clock-outline"
            title={t('common.loading')}
            subtitle={t('shareImport.loadingSubtitle')}
          />
        ) : notes.length === 0 ? (
          <EmptyState
            iconName="file-document-outline"
            title={t('shareImport.noNotesTitle')}
            subtitle={t('shareImport.noNotesBody')}
          />
        ) : (
          <FlatList
            data={notes}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ gap: 9, paddingBottom: 20 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => void onAppendToNote(item)}
                style={{
                  borderRadius: ui.radius.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  paddingHorizontal: ui.space.sm,
                  paddingVertical: 11,
                }}
              >
                <Text style={{ color: colors.text, fontFamily: 'NotoSansBengali', fontSize: ui.font.md }}>
                  {item.title}
                </Text>
                <Text style={{ color: colors.textSecondary, fontFamily: 'NotoSansBengali', marginTop: 4, fontSize: ui.font.sm }}>
                  {t('shareImport.tapToAppend', { count: pendingSharedFiles.length })}
                </Text>
              </Pressable>
            )}
          />
        )}

        {isImporting ? (
          <Text style={{ color: colors.textSecondary, fontFamily: 'NotoSansBengali', fontSize: ui.font.sm }}>
            {t('shareImport.importing')}
          </Text>
        ) : null}
      </View>
    </ScreenContainer>
  );
};
