import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { useShareIntentContext, type ShareIntentFile } from 'expo-share-intent';
import * as FileSystem from 'expo-file-system/legacy';
import { appendAudiosToNote, appendFilesToNote, listFolders, listNotesByFolder } from '../database/schema';
import { AppText } from '../components/AppText';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { TOP_BAR_HEIGHT, TopBar } from '../components/TopBar';
import { useEntrance } from '../components/entrance';
import { useLanguage } from '../i18n/LanguageContext';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { FolderListItem, Note, NoteAudioDraft, NoteFileDraft } from '../types/models';
import type { RootStackParamList } from '../types/navigation';
import {
  getBestAudioExtension,
  isProbablyAudioSource,
} from '../utils/audioFormat';
import { getFileExtension, getFileIcon, isProbablyFileSource } from '../utils/fileFormat';
import { deleteMediaFiles } from '../utils/mediaFiles';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'ShareImport'>;
type Route = RouteProp<RootStackParamList, 'ShareImport'>;

type PendingFile = { path: string; fileName: string; mimeType: string };

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
};

export const ShareImportScreen = () => {
  const route = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { colors } = useAppColors();
  const { t, language } = useLanguage();
  const insets = useSafeAreaInsets();
  const entrance = useEntrance();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();

  const [folders, setFolders] = useState<FolderListItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [hasAutoRedirected, setHasAutoRedirected] = useState(false);
  const [pendingSharedFiles, setPendingSharedFiles] = useState<PendingFile[]>([]);
  const [fileSizes, setFileSizes] = useState<Record<string, number>>({});

  const allRouteFiles = useMemo(() => route.params?.sharedFiles ?? [], [route.params?.sharedFiles]);

  const allIntentFiles = useMemo(() => {
    return (shareIntent.files ?? []).map((file: ShareIntentFile) => ({
      path: file.path,
      fileName: file.fileName,
      mimeType: file.mimeType,
    }));
  }, [shareIntent.files]);

  const isAudio = (file: PendingFile) => isProbablyAudioSource(file.mimeType, file.fileName, file.path);
  const isFile = (file: PendingFile) => isProbablyFileSource(file.mimeType, file.fileName, file.path);
  const isAcceptable = (file: PendingFile) => isAudio(file) || isFile(file);

  const routeSharedFiles = useMemo(() => allRouteFiles.filter(isAcceptable), [allRouteFiles]);

  const sharedIntentFiles = useMemo(() => allIntentFiles.filter(isAcceptable), [allIntentFiles]);

  const audioCount = useMemo(() => pendingSharedFiles.filter(isAudio).length, [pendingSharedFiles]);
  const fileCount = useMemo(() => pendingSharedFiles.filter(isFile).length, [pendingSharedFiles]);

  useEffect(() => {
    if (sharedIntentFiles.length > 0) {
      setPendingSharedFiles(sharedIntentFiles);
      return;
    }

    if (routeSharedFiles.length > 0) {
      setPendingSharedFiles(routeSharedFiles);
    }
  }, [routeSharedFiles, sharedIntentFiles]);

  useEffect(() => {
    let cancelled = false;
    const loadSizes = async () => {
      const entries = await Promise.all(
        pendingSharedFiles.map(async (file) => {
          try {
            const info = await FileSystem.getInfoAsync(file.path);
            const size = info.exists && !info.isDirectory ? Number(info.size ?? 0) : 0;
            return [file.path, size] as const;
          } catch {
            return [file.path, 0] as const;
          }
        })
      );
      if (!cancelled) {
        setFileSizes(Object.fromEntries(entries));
      }
    };

    void loadSizes();
    return () => {
      cancelled = true;
    };
  }, [pendingSharedFiles]);

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

  useEffect(() => {
    if (hasAutoRedirected) {
      return;
    }

    if (routeSharedFiles.length > 0 || sharedIntentFiles.length > 0 || pendingSharedFiles.length > 0) {
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
    sharedIntentFiles.length,
  ]);

  const ensureDirectory = async (dirName: string) => {
    const documentDirectory = FileSystem.documentDirectory;
    if (!documentDirectory) {
      throw new Error('Document directory unavailable');
    }
    const dir = `${documentDirectory}${dirName}`;
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    return dir;
  };

  const buildAudioDrafts = async (audioFiles: PendingFile[]): Promise<NoteAudioDraft[]> => {
    const audioDir = await ensureDirectory('audio');
    const drafts: NoteAudioDraft[] = [];
    try {
      for (const [index, file] of audioFiles.entries()) {
        const extension = getBestAudioExtension(file.mimeType, file.fileName, file.path);
        const fileName = file.fileName?.trim() || t('shareImport.sharedAudioDefault', { index: index + 1 });
        const targetPath = `${audioDir}/${Date.now()}_${index + 1}_shared.${extension}`;
        try {
          await FileSystem.copyAsync({ from: file.path, to: targetPath });
        } catch (copyError) {
          const detailed = copyError instanceof Error ? copyError.message : String(copyError);
          throw new Error(`Audio copy failed for ${fileName}: ${detailed}`);
        }
        drafts.push({ uri: targetPath, displayName: fileName });
      }
      return drafts;
    } catch (error) {
      await deleteMediaFiles(drafts.map((draft) => draft.uri));
      throw error;
    }
  };

  const buildFileDrafts = async (fileItems: PendingFile[]): Promise<NoteFileDraft[]> => {
    const filesDir = await ensureDirectory('files');
    const drafts: NoteFileDraft[] = [];
    try {
      for (const [index, file] of fileItems.entries()) {
        const extension = getFileExtension(file.mimeType, file.fileName, file.path);
        const fileName = file.fileName?.trim() || t('shareImport.sharedFileDefault', { index: index + 1 });
        const targetPath = `${filesDir}/${Date.now()}_${index + 1}_shared.${extension}`;
        try {
          await FileSystem.copyAsync({ from: file.path, to: targetPath });
        } catch (copyError) {
          const detailed = copyError instanceof Error ? copyError.message : String(copyError);
          throw new Error(`File copy failed for ${fileName}: ${detailed}`);
        }
        drafts.push({
          uri: targetPath,
          displayName: fileName,
          mimeType: file.mimeType?.trim() || 'application/octet-stream',
        });
      }
      return drafts;
    } catch (error) {
      await deleteMediaFiles(drafts.map((draft) => draft.uri));
      throw error;
    }
  };

  const onAppendToNote = async (note: Note) => {
    if (isImporting) {
      return;
    }

    const copiedUris: string[] = [];
    const committedUris = new Set<string>();

    try {
      setIsImporting(true);

      const audioFiles = pendingSharedFiles.filter(isAudio);
      const fileItems = pendingSharedFiles.filter(isFile);

      if (audioFiles.length > 0) {
        const audioDrafts = await buildAudioDrafts(audioFiles);
        copiedUris.push(...audioDrafts.map((draft) => draft.uri));
        await appendAudiosToNote(note.id, audioDrafts);
        audioDrafts.forEach((draft) => committedUris.add(draft.uri));
      }

      if (fileItems.length > 0) {
        const fileDrafts = await buildFileDrafts(fileItems);
        copiedUris.push(...fileDrafts.map((draft) => draft.uri));
        await appendFilesToNote(note.id, fileDrafts);
        fileDrafts.forEach((draft) => committedUris.add(draft.uri));
      }

      resetShareIntent();
      setPendingSharedFiles([]);
      Alert.alert(
        t('shareImport.importedTitle'),
        t('shareImport.importedBody', { count: pendingSharedFiles.length, title: note.title })
      );
      navigation.navigate('NotesList', {
        folderId: note.folderId,
        folderName: folders.find((folder) => folder.id === note.folderId)?.name ?? t('header.notes'),
      });
    } catch (error) {
      await deleteMediaFiles(copiedUris.filter((uri) => !committedUris.has(uri)));
      console.warn('Failed to append shared files:', error);
      const detailed = error instanceof Error ? error.message : String(error);
      Alert.alert(t('common.error'), `${t('shareImport.appendError')}\n${detailed}`);
    } finally {
      setIsImporting(false);
    }
  };

  const getFileRowIcon = (file: PendingFile): keyof typeof MaterialCommunityIcons.glyphMap => {
    if (isAudio(file)) {
      return 'music-note';
    }
    return getFileIcon(file.mimeType) as keyof typeof MaterialCommunityIcons.glyphMap;
  };

  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;

  if (pendingSharedFiles.length === 0) {
    return (
      <ScreenContainer>
        <EmptyState
          iconName="share-variant-outline"
          title={t('shareImport.noShareTitle')}
          subtitle={t('shareImport.noShareBody')}
        />
        <TopBar onBack={() => navigation.goBack()}>
          <LanguageToggleButton />
        </TopBar>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View style={{ flex: 1, paddingHorizontal: ui.space.lg }}>
        <FlatList
          data={notes}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{
            paddingTop: insets.top + ui.space.sm + TOP_BAR_HEIGHT + ui.space.md,
            paddingBottom: ui.space.md,
            gap: ui.space.md,
          }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ gap: ui.space.md }}>
              <AppText variant="display" numberOfLines={2}>
                {t('header.shareImportFiles')}
              </AppText>

              <View style={{ gap: ui.space.sm }}>
                {pendingSharedFiles.map((file) => {
                  const size = formatBytes(fileSizes[file.path] ?? 0);
                  return (
                    <Card key={file.path} style={{ flexDirection: 'row', alignItems: 'center', gap: ui.space.md }}>
                      <MaterialCommunityIcons
                        name={getFileRowIcon(file)}
                        size={24}
                        color={colors.textSecondary}
                      />
                      <View style={{ flex: 1 }}>
                        <AppText variant="bodySmall" numberOfLines={2}>
                          {file.fileName || t('shareImport.sharedFileDefault', { index: 1 })}
                        </AppText>
                        {size ? (
                          <AppText variant="caption" color={colors.textSecondary}>
                            {size}
                          </AppText>
                        ) : null}
                      </View>
                    </Card>
                  );
                })}
                {audioCount > 0 ? (
                  <AppText variant="bodySmall" color={colors.textSecondary}>
                    {t('shareImport.audioCount', { count: audioCount })}
                  </AppText>
                ) : null}
                {fileCount > 0 ? (
                  <AppText variant="bodySmall" color={colors.textSecondary}>
                    {t('shareImport.fileCount', { count: fileCount })}
                  </AppText>
                ) : null}
              </View>

              <AppText variant="headline">{t('shareImport.selectFolder')}</AppText>

              <View style={{ gap: ui.space.sm }}>
                {folders.map((folder) => {
                  const isSelected = selectedFolderId === folder.id;
                  return (
                    <Card
                      key={folder.id}
                      onPress={() => {
                        setSelectedFolderId(folder.id);
                        setSelectedNoteId(null);
                      }}
                      tint={isSelected ? colors.surfaceVariant : colors.surface}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: ui.space.md }}
                    >
                      <MaterialCommunityIcons
                        name="folder-outline"
                        size={22}
                        color={isSelected ? colors.primary : colors.textSecondary}
                      />
                      <AppText variant="headline" style={{ flex: 1 }} numberOfLines={1}>
                        {folder.name}
                      </AppText>
                      {isSelected ? (
                        <MaterialCommunityIcons name="check-circle" size={22} color={colors.primary} />
                      ) : null}
                    </Card>
                  );
                })}
              </View>

              <AppText variant="headline">{t('shareImport.selectNote')}</AppText>
            </View>
          }
          ListEmptyComponent={
            isLoading ? (
              <EmptyState
                iconName="folder-clock-outline"
                title={t('common.loading')}
                subtitle={t('shareImport.loadingSubtitle')}
              />
            ) : (
              <EmptyState
                iconName="file-document-outline"
                title={t('shareImport.noNotesTitle')}
                subtitle={t('shareImport.noNotesBody')}
              />
            )
          }
          renderItem={({ item, index }) => {
            const isSelected = selectedNoteId === item.id;
            return (
              <Animated.View entering={entrance(index)}>
                <Card
                  onPress={() => setSelectedNoteId(item.id)}
                  tint={isSelected ? colors.surfaceVariant : colors.surface}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: ui.space.md }}
                >
                  <AppText variant="headline" numberOfLines={2} style={{ flex: 1 }}>
                    {item.title}
                  </AppText>
                  {isSelected ? (
                    <MaterialCommunityIcons name="check-circle" size={22} color={colors.primary} />
                  ) : null}
                </Card>
              </Animated.View>
            );
          }}
        />

        <View style={{ paddingBottom: ui.space.sm }}>
          <PrimaryButton
            onPress={() => {
              if (selectedNote) {
                void onAppendToNote(selectedNote);
              }
            }}
            disabled={!selectedNote || isImporting}
          >
            {isImporting
              ? t('shareImport.importing')
              : t('shareImport.tapToAppend', { count: pendingSharedFiles.length })}
          </PrimaryButton>
        </View>
      </View>

      <TopBar onBack={() => navigation.goBack()}>
        <LanguageToggleButton />
      </TopBar>
    </ScreenContainer>
  );
};
