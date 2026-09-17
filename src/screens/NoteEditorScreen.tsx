import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import type { ViewStyle } from 'react-native';
import { useMentions } from 'react-native-controlled-mentions';
import type { TriggersConfig } from 'react-native-controlled-mentions';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionSheet } from '../components/ActionSheet';
import type { ActionSheetRow } from '../components/ActionSheet';
import { AppText, getFontFamily } from '../components/AppText';
import { BottomSheet } from '../components/BottomSheet';
import { EditorAttachments, type AudioAttachmentHandle, type AudioGroup } from '../components/EditorAttachments';
import { EditorRecordingBar } from '../components/EditorRecordingBar';
import { GlassSurface } from '../components/GlassSurface';
import { IconButton } from '../components/IconButton';
import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { NoteContentView } from '../components/NoteContentView';
import { PressableScale } from '../components/PressableScale';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { TOP_BAR_HEIGHT, TopBar } from '../components/TopBar';
import { createNote, deleteUnreferencedMediaFiles, getNoteById, updateNote } from '../database/schema';
import { useLanguage } from '../i18n/LanguageContext';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { NoteAudioDraft, NoteDraft, NoteFileDraft } from '../types/models';
import type { RootStackParamList } from '../types/navigation';
import {
  getBestAudioExtension,
  getMimeTypeForAudioExtension,
  getPreferredShareExtension,
  isShareFriendlyAudioExtension,
} from '../utils/audioFormat';
import {
  attachmentTagId,
  attachmentTextForSharing,
  attachmentTokenPattern,
  encodeAttachmentReference,
  filterAttachmentTags,
  listAttachmentTags,
  parseAttachmentTagId,
  parseAttachmentToken,
  resolveAttachment,
  rewriteAttachmentReferences,
} from '../utils/attachmentReferences';
import { getFileExtension, getFileIcon, getFileMimeType, isImageFile, isImageMimeType, isPdfMimeType } from '../utils/fileFormat';
import { createDraftPortableId } from '../utils/portableId';
import { shouldAutoSaveBeforeHome } from '../utils/editorExit';

type Route = RouteProp<RootStackParamList, 'NoteEditor'>;
type Navigation = NativeStackNavigationProp<RootStackParamList, 'NoteEditor'>;

type EditorSheet =
  | 'none'
  | 'overflow'
  | 'groupActions'
  | 'fileActions'
  | 'rename'
  | 'sharePicker'
  | 'details';

const ensureAudioFolder = async () => {
  const documentDirectory = FileSystem.documentDirectory;
  if (!documentDirectory) {
    throw new Error('Document directory is unavailable');
  }
  const path = `${documentDirectory}audio`;
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
  return path;
};

const getAudioFileExtension = (fileName: string) => getBestAudioExtension(null, fileName, fileName);

const ensureFileFolder = async () => {
  const documentDirectory = FileSystem.documentDirectory;
  if (!documentDirectory) {
    throw new Error('Document directory is unavailable');
  }
  const path = `${documentDirectory}files`;
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
  return path;
};

const createAudioGroupId = () => `audio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const FLAG_GRANT_READ_URI_PERMISSION = 1;

const barShadow: ViewStyle = {
  shadowColor: '#000000',
  shadowOpacity: 0.12,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 6,
};

export const NoteEditorScreen = () => {
  const route = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { colors } = useAppColors();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { t, language } = useLanguage();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [audios, setAudios] = useState<NoteAudioDraft[]>([]);
  const [files, setFiles] = useState<NoteFileDraft[]>([]);
  const [viewingFileUri, setViewingFileUri] = useState<string | null>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [appendTargetGroupId, setAppendTargetGroupId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(Boolean(route.params.noteId));
  const [loadError, setLoadError] = useState(false);
  const [contentInputHeight, setContentInputHeight] = useState(230);
  const [activeSheet, setActiveSheet] = useState<EditorSheet>('none');
  const [actionsGroupId, setActionsGroupId] = useState<string | null>(null);
  const [actionsFile, setActionsFile] = useState<NoteFileDraft | null>(null);
  const [renameTargetGroupId, setRenameTargetGroupId] = useState<string | null>(null);
  const [renameTargetFileUri, setRenameTargetFileUri] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [detailsTargetGroupId, setDetailsTargetGroupId] = useState<string | null>(null);
  const [isReadingContent, setIsReadingContent] = useState(false);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const isFinalizingRecordingRef = useRef(false);
  const editorAttachmentsRef = useRef<AudioAttachmentHandle>(null);
  const initialDraftRef = useRef<NoteDraft>({ title: '', content: '', audios: [], files: [] });
  const skipUnsavedWarningRef = useRef(false);
  const isAutoSavingRef = useRef(false);
  const persistenceInFlightRef = useRef(false);
  const persistedNoteIdRef = useRef<number | undefined>(route.params.noteId);
  const initialUpdatedAtRef = useRef<string | undefined>(undefined);

  const { folderId, noteId } = route.params;
  const createDefaultAudioName = (order: number) => t('editor.audioDefaultName', { index: order });

  const closeSheet = () => setActiveSheet('none');

  useEffect(() => {
    let cancelled = false;
    const loadNote = async () => {
      if (!noteId) {
        return;
      }
      try {
        const note = await getNoteById(noteId);
        if (cancelled) return;
        if (!note) {
          Alert.alert(t('editor.notFoundTitle'), t('editor.notFoundBody'));
          navigation.goBack();
          return;
        }

        const loadedAudios = (note.audios ?? []).map((audio, index) => ({
          portableId: audio.portableId,
          uri: audio.uri,
          displayName:
            audio.displayName?.trim() || createDefaultAudioName(audio.orderIndex || index + 1),
          groupId: audio.groupId,
          segmentIndex: audio.segmentIndex,
        }));

        const loadedFiles = (note.files ?? []).map((file) => ({
          portableId: file.portableId,
          uri: file.uri,
          displayName: file.displayName,
          mimeType: file.mimeType,
        }));

        setTitle(note.title);
        setContent(note.content);
        setAudios(loadedAudios);
        setFiles(loadedFiles);
        initialUpdatedAtRef.current = note.updatedAt;
        initialDraftRef.current = {
          title: note.title,
          content: note.content,
          audios: loadedAudios.map((audio) => ({ ...audio })),
          files: loadedFiles.map((file) => ({ ...file })),
        };
      } catch (error) {
        console.warn('Failed to load note:', error);
        if (!cancelled) {
          setLoadError(true);
          Alert.alert(t('common.error'), t('editor.loadError'));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadNote();
    return () => { cancelled = true; };
  }, [navigation, noteId]);

  useEffect(() => {
    setLoadError(false);
    setIsLoading(Boolean(noteId));
    persistedNoteIdRef.current = noteId;
    initialUpdatedAtRef.current = undefined;
    if (!noteId) {
      initialDraftRef.current = { title: '', content: '', audios: [], files: [] };
    }
  }, [noteId]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    return () => {
      const activeRecording = recordingRef.current;
      if (activeRecording) {
        activeRecording.stopAndUnloadAsync().catch(() => undefined);
      }
      void Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      }).catch(() => undefined);
    };
  }, []);

  const saveDisabled = useMemo(() => !title.trim() || isSaving, [title, isSaving]);

  const audioGroups = useMemo<AudioGroup[]>(() => {
    const map = new Map<string, AudioGroup>();
    const fallbackMap = new Map<string, string>();
    let fallbackCounter = 0;

    for (const audio of audios) {
      const rawGroupId = audio.groupId?.trim();
      if (rawGroupId) {
        if (!map.has(rawGroupId)) {
          map.set(rawGroupId, {
            groupId: rawGroupId,
            displayName: audio.displayName,
            segments: [],
          });
        }
        const target = map.get(rawGroupId);
        if (!target) {
          continue;
        }
        target.segments.push(audio);
        if (audio.segmentIndex === 1 && audio.displayName.trim()) {
          target.displayName = audio.displayName;
        }
        continue;
      }

      const key = `${audio.displayName.trim()}::${audio.uri}`;
      let fallbackId = fallbackMap.get(key);
      if (!fallbackId) {
        fallbackCounter += 1;
        fallbackId = `legacy_group_${fallbackCounter}`;
        fallbackMap.set(key, fallbackId);
      }
      if (!map.has(fallbackId)) {
        map.set(fallbackId, {
          groupId: fallbackId,
          displayName: audio.displayName,
          segments: [],
        });
      }
      const target = map.get(fallbackId);
      if (target) {
        target.segments.push(audio);
      }
    }

    return Array.from(map.values()).map((group) => ({
      ...group,
      segments: [...group.segments].sort(
        (a, b) => Number(a.segmentIndex ?? 1) - Number(b.segmentIndex ?? 1)
      ),
    }));
  }, [audios]);

  const attachmentCatalog = useMemo(() => ({ audioGroups, files }), [audioGroups, files]);
  const attachmentTags = useMemo(() => listAttachmentTags(attachmentCatalog), [attachmentCatalog]);

  const attachmentMentions = useMemo<TriggersConfig<'attachment'>>(() => ({
    attachment: {
      trigger: '@',
      pattern: attachmentTokenPattern,
      allowedSpacesCount: 2,
      isInsertSpaceAfterMention: true,
      textStyle: () => ({
        color: colors.primary,
        fontFamily: getFontFamily(language, '600'),
        fontWeight: language === 'bn' ? undefined : '600',
      }),
      getPlainString: (data) => `@${data.name}`,
      getTriggerData: (token) => {
        const reference = parseAttachmentToken(token);
        return reference
          ? { original: token, trigger: '@', name: reference.name, id: attachmentTagId(reference) }
          : { original: token, trigger: '@', name: token, id: token };
      },
      getTriggerValue: (suggestion) => {
        const identity = parseAttachmentTagId(suggestion.id);
        return identity
          ? encodeAttachmentReference({ ...identity, name: suggestion.name })
          : `@${suggestion.name}`;
      },
    },
  }), [colors.primary, language]);

  const { textInputProps, triggers } = useMentions({
    value: content,
    onChange: setContent,
    triggersConfig: attachmentMentions,
  });
  const attachmentKeyword = triggers.attachment.keyword;
  const suggestedAttachments = useMemo(
    () => (attachmentKeyword === undefined ? [] : filterAttachmentTags(attachmentTags, attachmentKeyword)),
    [attachmentKeyword, attachmentTags],
  );

  const hasUnsavedChanges = useMemo(() => {
    const initial = initialDraftRef.current;
    if (title !== initial.title || content !== initial.content) {
      return true;
    }

    if (audios.length !== initial.audios.length) {
      return true;
    }

    if (files.length !== initial.files.length) {
      return true;
    }

    if (
      files.some(
        (file, index) =>
          file.uri !== initial.files[index]?.uri ||
          file.displayName !== initial.files[index]?.displayName ||
          file.mimeType !== initial.files[index]?.mimeType
      )
    ) {
      return true;
    }

    return audios.some(
      (audio, index) =>
        audio.uri !== initial.audios[index]?.uri ||
        audio.displayName !== initial.audios[index]?.displayName ||
        audio.groupId !== initial.audios[index]?.groupId ||
        Number(audio.segmentIndex ?? 1) !== Number(initial.audios[index]?.segmentIndex ?? 1)
    );
  }, [audios, content, files, title]);

  const persistDraft = async (draft: NoteDraft, errorMessage: string): Promise<boolean> => {
    try {
      setIsSaving(true);
      if (persistedNoteIdRef.current) {
        initialUpdatedAtRef.current = await updateNote(
          persistedNoteIdRef.current,
          draft,
          { expectedUpdatedAt: initialUpdatedAtRef.current },
        );
      } else {
        persistedNoteIdRef.current = await createNote(folderId, draft);
      }

      initialDraftRef.current = {
        title: draft.title,
        content: draft.content,
        audios: draft.audios.map((audio) => ({ ...audio })),
        files: draft.files.map((file) => ({ ...file })),
      };
      return true;
    } catch (error) {
      console.warn('Failed to persist note:', error);
      Alert.alert(t('common.error'), errorMessage);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const withPersistenceLock = async (work: () => Promise<boolean>): Promise<boolean> => {
    if (persistenceInFlightRef.current) return false;
    persistenceInFlightRef.current = true;
    try {
      return await work();
    } finally {
      persistenceInFlightRef.current = false;
    }
  };

  const saveNote = async () => withPersistenceLock(async () => {
    const audiosForSave = await flushActiveRecordingForSave();
    if (!audiosForSave) return false;

    if (!title.trim()) {
      Alert.alert(t('editor.missingTitleTitle'), t('editor.missingTitleBody'));
      return false;
    }

    const draft: NoteDraft = {
      title: title.trim(),
      content,
      audios: audiosForSave,
      files,
    };

    return persistDraft(draft, t('editor.saveError'));
  });

  const autoSaveBeforeExit = async () => withPersistenceLock(async () => {
    const audiosForSave = await flushActiveRecordingForSave();
    if (!audiosForSave) return false;

    const trimmedTitle = title.trim();
    const trimmedContent = attachmentTextForSharing(content).trim();

    if (!trimmedTitle && !trimmedContent && audiosForSave.length === 0 && files.length === 0) {
      return true;
    }

    const autoTitle = trimmedTitle || trimmedContent.slice(0, 36) || t('editor.autoTitle');
    const draft: NoteDraft = {
      title: autoTitle,
      content,
      audios: audiosForSave,
      files,
    };

    return persistDraft(draft, t('editor.autoSaveError'));
  });

  const goHome = async () => {
    if (isAutoSavingRef.current) return;
    isAutoSavingRef.current = true;
    try {
      const didSave = !shouldAutoSaveBeforeHome(hasUnsavedChanges, recording !== null) || await autoSaveBeforeExit();
      if (!didSave) return;
      skipUnsavedWarningRef.current = true;
      navigation.reset({ index: 0, routes: [{ name: 'Folders' }] });
    } finally {
      isAutoSavingRef.current = false;
    }
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (skipUnsavedWarningRef.current) {
        return;
      }

      if (isAutoSavingRef.current) {
        event.preventDefault();
        return;
      }

      if (persistenceInFlightRef.current) {
        event.preventDefault();
        return;
      }

      if (!hasUnsavedChanges && !recordingRef.current) return;

      event.preventDefault();

      isAutoSavingRef.current = true;
      void (async () => {
        const didSave = await autoSaveBeforeExit();
        if (didSave) {
          skipUnsavedWarningRef.current = true;
          navigation.dispatch(event.data.action);
        }
        isAutoSavingRef.current = false;
      })();
    });

    return unsubscribe;
  }, [autoSaveBeforeExit, hasUnsavedChanges, navigation]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => {
      if (skipUnsavedWarningRef.current || isAutoSavingRef.current || persistenceInFlightRef.current) return;
      if (!hasUnsavedChanges && !recordingRef.current) return;

      isAutoSavingRef.current = true;
      void autoSaveBeforeExit().finally(() => {
        isAutoSavingRef.current = false;
      });
    });

    return unsubscribe;
  }, [autoSaveBeforeExit, hasUnsavedChanges, navigation]);

  const appendAudio = (
    uri: string,
    preferredName?: string,
    options?: { groupId?: string; segmentIndex?: number }
  ) => {
    setAudios((prev) => {
      const order = prev.length + 1;
      const groupId = options?.groupId?.trim() || createAudioGroupId();
      return [
        ...prev,
        {
          portableId: createDraftPortableId(),
          uri,
          displayName: preferredName?.trim() || createDefaultAudioName(order),
          groupId,
          segmentIndex: Number(options?.segmentIndex ?? 1),
        },
      ];
    });
  };

  const importFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
      });
      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];
      const directory = await ensureFileFolder();
      const extension = getFileExtension(null, asset.name, asset.uri);
      const targetPath = `${directory}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extension}`;
      await FileSystem.copyAsync({ from: asset.uri, to: targetPath });

      const mimeType = getFileMimeType(extension);
      setFiles((prev) => [
        ...prev,
        {
          portableId: createDraftPortableId(),
          uri: targetPath,
          displayName: asset.name?.trim() || `File ${prev.length + 1}`,
          mimeType,
        },
      ]);
    } catch (error) {
      console.warn('Failed to import file:', error);
      Alert.alert(t('common.error'), t('editor.fileImportError'));
    }
  };

  const removeFile = (file: NoteFileDraft) => {
    const wasPersisted = initialDraftRef.current.files.some((item) => item.uri === file?.uri);
    if (file && !wasPersisted) {
      void deleteUnreferencedMediaFiles([file.uri]);
    }
    setFiles((prev) => prev.filter((item) => item !== file));
    if (file?.portableId) {
      const removedFileId = file.portableId;
      const removedName = file.displayName;
      setContent((prev) => rewriteAttachmentReferences(prev, (reference) =>
        reference.kind === 'file' && reference.id === removedFileId ? removedName : undefined));
    }
  };

  const shareSpecificFile = useCallback(async (file: NoteFileDraft) => {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(t('editor.shareUnavailableTitle'), t('editor.shareUnavailableBody'));
        return;
      }

      await Sharing.shareAsync(file.uri, {
        dialogTitle: file.displayName,
        mimeType: file.mimeType,
      });
    } catch (error) {
      console.warn('Failed to share file:', error);
      Alert.alert(t('common.error'), t('editor.shareFileError'));
    }
  }, [t]);

  const openFile = useCallback(async (file: NoteFileDraft) => {
    const isImage = isImageFile(file.mimeType, file.displayName, file.uri);
    if (isImage) {
      setViewingFileUri(file.uri);
      return;
    }

    try {
      const mimeType =
        file.mimeType?.trim() || getFileMimeType(getFileExtension(null, file.displayName, file.uri));
      const contentUri = await FileSystem.getContentUriAsync(file.uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        type: mimeType,
        flags: FLAG_GRANT_READ_URI_PERMISSION,
      });
    } catch (error) {
      console.warn('No app could open the file directly, falling back to share:', error);
      await shareSpecificFile(file);
    }
  }, [shareSpecificFile]);

  const openGroupActions = useCallback((groupId: string) => {
    setActionsGroupId(groupId);
    setActiveSheet('groupActions');
  }, []);

  const openFileActions = useCallback((file: NoteFileDraft) => {
    setActionsFile(file);
    setActiveSheet('fileActions');
  }, []);

  const importAudio = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];
      const directory = await ensureAudioFolder();
      const serial = audios.length + 1;
      const extension = getAudioFileExtension(asset.name);
      const targetPath = `${directory}/${Date.now()}_${serial}_import.${extension}`;
      await FileSystem.copyAsync({ from: asset.uri, to: targetPath });
      appendAudio(targetPath, asset.name?.trim() || createDefaultAudioName(audioGroups.length + 1), {
        groupId: createAudioGroupId(),
        segmentIndex: 1,
      });
    } catch (error) {
      console.warn('Failed to import audio:', error);
      Alert.alert(t('common.error'), t('editor.audioImportError'));
    }
  };

  const resetAudioModeForPlayback = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
    } catch {
      // ignore
    }
  };

  const nextSegmentIndexForGroup = (groupId: string) => {
    const group = audioGroups.find((item) => item.groupId === groupId);
    return (group?.segments ?? []).reduce((max, audio) => Math.max(max, Number(audio.segmentIndex ?? 1)), 0) + 1;
  };

  const persistRecordingFile = async (uri: string, suffix: 'record' | 'append') => {
    const directory = await ensureAudioFolder();
    const serial = audios.length + 1;
    const targetPath = `${directory}/${Date.now()}_${serial}_${suffix}.m4a`;
    try {
      await FileSystem.copyAsync({ from: uri, to: targetPath });
    } catch (firstCopyError) {
      console.warn('First recording copy failed, retrying:', firstCopyError);
      await FileSystem.copyAsync({ from: uri, to: targetPath });
    }
    return targetPath;
  };

  const stopActiveRecording = async (): Promise<{ uri: string; appendGroupId: string | null } | null> => {
    if (!recording || isFinalizingRecordingRef.current) {
      return null;
    }
    isFinalizingRecordingRef.current = true;
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      const appendGroupId = appendTargetGroupId;
      setRecording(null);
      setIsRecordingPaused(false);
      setAppendTargetGroupId(null);
      return uri ? { uri, appendGroupId } : null;
    } finally {
      isFinalizingRecordingRef.current = false;
      void resetAudioModeForPlayback();
    }
  };

  const startRecordingSession = async (groupId: string | null) => {
    if (recording || isFinalizingRecordingRef.current) {
      return;
    }

    if (groupId && !audioGroups.some((group) => group.groupId === groupId)) {
      return;
    }

    try {
      await editorAttachmentsRef.current?.stopPlayback();

      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('editor.micPermissionTitle'), t('editor.micPermissionBody'));
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const newRecording = new Audio.Recording();
      await newRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await newRecording.startAsync();
      setAppendTargetGroupId(groupId);
      setIsRecordingPaused(false);
      setRecording(newRecording);
    } catch (error) {
      console.warn('Failed to start recording session:', error);
      void resetAudioModeForPlayback();
      Alert.alert(t('common.error'), t('editor.recordStartError'));
    }
  };

  const startRecording = async () => startRecordingSession(null);

  const stopRecording = async () => {
    if (!recording || appendTargetGroupId) {
      return;
    }

    try {
      const finalized = await stopActiveRecording();
      if (!finalized) {
        return;
      }

      const targetPath = await persistRecordingFile(finalized.uri, 'record');
      appendAudio(targetPath, createDefaultAudioName(audioGroups.length + 1), {
        groupId: createAudioGroupId(),
        segmentIndex: 1,
      });
    } catch (error) {
      console.warn('Failed to stop recording:', error);
      Alert.alert(t('common.error'), t('editor.recordStopError'));
    }
  };

  const startAppendRecording = async (groupId: string) => {
    return startRecordingSession(groupId);
  };

  const stopAppendRecording = async (groupId: string) => {
    if (!recording || appendTargetGroupId !== groupId) {
      return;
    }

    try {
      const finalized = await stopActiveRecording();
      if (!finalized) {
        return;
      }

      const targetGroup = audioGroups.find((group) => group.groupId === groupId);
      const targetPath = await persistRecordingFile(finalized.uri, 'append');
      appendAudio(targetPath, targetGroup?.displayName || createDefaultAudioName(audioGroups.length + 1), {
        groupId,
        segmentIndex: nextSegmentIndexForGroup(groupId),
      });
    } catch (error) {
      console.warn('Failed to stop append recording:', error);
      Alert.alert(t('common.error'), t('editor.recordStopError'));
    }
  };

  const flushActiveRecordingForSave = async (): Promise<NoteAudioDraft[] | null> => {
    if (!recording) {
      return audios;
    }

    if (isFinalizingRecordingRef.current) {
      Alert.alert(t('common.error'), t('editor.recordStopError'));
      return null;
    }

    try {
      const finalized = await stopActiveRecording();
      if (!finalized) {
        return audios;
      }

      const targetPath = await persistRecordingFile(
        finalized.uri,
        finalized.appendGroupId ? 'append' : 'record'
      );
      const activeAppendGroupId = finalized.appendGroupId;

      if (activeAppendGroupId) {
        const targetSegments = audios.filter((audio) => audio.groupId === activeAppendGroupId);
        const nextSegmentIndex =
          targetSegments.reduce((max, audio) => Math.max(max, Number(audio.segmentIndex ?? 1)), 0) + 1;
        const displayName = targetSegments[0]?.displayName || createDefaultAudioName(audioGroups.length + 1);
        const nextAudios: NoteAudioDraft[] = [
          ...audios,
          {
            portableId: createDraftPortableId(),
            uri: targetPath,
            displayName,
            groupId: activeAppendGroupId,
            segmentIndex: nextSegmentIndex,
          },
        ];
        setAudios(nextAudios);
        return nextAudios;
      }

      const uniqueGroupCount = new Set(audios.map((audio) => audio.groupId).filter(Boolean)).size;
      const nextAudios: NoteAudioDraft[] = [
        ...audios,
        {
          portableId: createDraftPortableId(),
          uri: targetPath,
          displayName: createDefaultAudioName(uniqueGroupCount + 1),
          groupId: createAudioGroupId(),
          segmentIndex: 1,
        },
      ];
      setAudios(nextAudios);
      return nextAudios;
    } catch (error) {
      console.warn('Failed to finalize recording before save:', error);
      Alert.alert(t('common.error'), t('editor.recordStopError'));
      return null;
    }
  };

  const toggleRecordingPause = async () => {
    if (!recording || isFinalizingRecordingRef.current) {
      return;
    }

    try {
      if (isRecordingPaused) {
        await recording.startAsync();
        setIsRecordingPaused(false);
        return;
      }

      await recording.pauseAsync();
      setIsRecordingPaused(true);
    } catch (error) {
      console.warn('Failed to toggle recording pause:', error);
      Alert.alert(t('common.error'), t('editor.recordPauseError'));
    }
  };

  const removeAudioGroup = (groupId: string) => {
    if (recording && appendTargetGroupId === groupId) {
      return;
    }

    const persistedUris = new Set(initialDraftRef.current.audios.map((audio) => audio.uri));
    const sessionUris = audios
      .filter((audio) => audio.groupId === groupId && !persistedUris.has(audio.uri))
      .map((audio) => audio.uri);
    if (sessionUris.length > 0) {
      void deleteUnreferencedMediaFiles(sessionUris);
    }

    setAudios((prev) => prev.filter((audio) => audio.groupId !== groupId));
    const removedGroupName =
      audioGroups.find((group) => group.groupId === groupId)?.displayName ?? '';
    setContent((prev) => rewriteAttachmentReferences(prev, (reference) => {
      const resolved = resolveAttachment(reference, attachmentCatalog);
      return resolved?.kind === 'audio' && resolved.groupId === groupId
        ? removedGroupName || reference.name
        : undefined;
    }));
  };

  const startRenameAudioGroup = (groupId: string) => {
    const group = audioGroups.find((item) => item.groupId === groupId);
    setRenameTargetGroupId(groupId);
    setRenameTargetFileUri(null);
    setRenameValue(group?.displayName ?? '');
    setActiveSheet('rename');
  };

  const saveAttachmentRename = () => {
    if (!renameTargetGroupId && !renameTargetFileUri) {
      return;
    }

    const trimmed = renameValue.trim();
    if (!trimmed) {
      Alert.alert(
        t(renameTargetFileUri ? 'editor.fileRenameMissingTitle' : 'editor.renameMissingTitle'),
        t(renameTargetFileUri ? 'editor.fileRenameMissingBody' : 'editor.renameMissingBody')
      );
      return;
    }

    if (renameTargetGroupId) {
      setAudios((prev) => prev.map((audio) => audio.groupId === renameTargetGroupId ? { ...audio, displayName: trimmed } : audio));
      setContent((prev) => rewriteAttachmentReferences(prev, (reference) => {
        const resolved = resolveAttachment(reference, attachmentCatalog);
        return resolved?.kind === 'audio' && resolved.groupId === renameTargetGroupId
          ? encodeAttachmentReference({ kind: 'audio', id: resolved.id, name: trimmed })
          : undefined;
      }));
    } else {
      const renamedFile = files.find((file) => file.uri === renameTargetFileUri);
      setFiles((prev) => prev.map((file) => file.uri === renameTargetFileUri ? { ...file, displayName: trimmed } : file));
      if (renamedFile) {
        setContent((prev) => rewriteAttachmentReferences(prev, (reference) => {
          const resolved = resolveAttachment(reference, attachmentCatalog);
          return resolved?.kind === 'file' && resolved.file.uri === renamedFile.uri
            ? encodeAttachmentReference({ kind: 'file', id: resolved.id, name: trimmed })
            : undefined;
        }));
      }
    }
    setRenameTargetGroupId(null);
    setRenameTargetFileUri(null);
    setRenameValue('');
    closeSheet();
  };

  const copyTextContent = async () => {
    try {
      await Clipboard.setStringAsync(attachmentTextForSharing(content));
      Alert.alert(t('editor.copySuccessTitle'), t('editor.copySuccessBody'));
    } catch (error) {
      console.warn('Failed to copy text:', error);
      Alert.alert(t('common.error'), t('editor.copyError'));
    }
  };

  const shareText = async () => {
    try {
      const textForSharing = attachmentTextForSharing(content).trim() || title.trim();
      if (!textForSharing) {
        Alert.alert(t('editor.noTextTitle'), t('editor.noTextBody'));
        return;
      }

      await Clipboard.setStringAsync(textForSharing);

      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(t('editor.shareUnavailableTitle'), t('editor.shareUnavailableBody'));
        return;
      }

      const cacheDirectory = FileSystem.cacheDirectory;
      if (!cacheDirectory) {
        throw new Error('Cache directory is unavailable');
      }

      const textPath = `${cacheDirectory}note-share-${Date.now()}.txt`;
      await FileSystem.writeAsStringAsync(textPath, textForSharing, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      await Sharing.shareAsync(textPath, {
        dialogTitle: t('editor.shareText'),
      });
    } catch (error) {
      console.warn('Failed to share text:', error);
      Alert.alert(t('common.error'), t('editor.shareTextError'));
    }
  };

  const shareSpecificAudio = async (audio: NoteAudioDraft) => {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(t('editor.shareUnavailableTitle'), t('editor.shareUnavailableBody'));
        return;
      }

      const extension = getBestAudioExtension(null, audio.displayName, audio.uri);
      const preferredExtension = getPreferredShareExtension(extension);

      let shareUri = audio.uri;
      if (!isShareFriendlyAudioExtension(extension) || extension !== preferredExtension) {
        const cacheDirectory = FileSystem.cacheDirectory;
        if (!cacheDirectory) {
          throw new Error('Cache directory is unavailable');
        }
        const normalizedPath = `${cacheDirectory}audio-share-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}.${preferredExtension}`;
        await FileSystem.copyAsync({ from: audio.uri, to: normalizedPath });
        shareUri = normalizedPath;
      }

      await Sharing.shareAsync(shareUri, {
        dialogTitle: audio.displayName,
        mimeType: getMimeTypeForAudioExtension(preferredExtension),
      });
      closeSheet();
    } catch (error) {
      console.warn('Failed to share audio:', error);
      Alert.alert(t('common.error'), t('editor.shareAudioError'));
    }
  };

  const onContentSizeChange = (height: number) => {
    const minHeight = 230;
    setContentInputHeight(Math.max(minHeight, Math.ceil(height)));
  };

  const isAppendRecordingActive = Boolean(recording && appendTargetGroupId);
  const stopRecordingHandler = isAppendRecordingActive
    ? () => void stopAppendRecording(appendTargetGroupId ?? '')
    : () => void stopRecording();

  const groupActionRows: ActionSheetRow[] = actionsGroupId
    ? [
        {
          icon: recording && appendTargetGroupId === actionsGroupId ? 'stop' : 'plus-circle-outline',
          label:
            recording && appendTargetGroupId === actionsGroupId
              ? t('editor.appendStop')
              : t('editor.audioAdd'),
          onPress: () => {
            if (recording && appendTargetGroupId === actionsGroupId) {
              void stopAppendRecording(actionsGroupId);
              return;
            }
            void startAppendRecording(actionsGroupId);
          },
        },
        {
          icon: 'pencil-outline',
          label: t('action.rename'),
          onPress: () => startRenameAudioGroup(actionsGroupId),
        },
        {
          icon: 'information-outline',
          label: t('editor.audioDetails'),
          onPress: () => {
            setDetailsTargetGroupId(actionsGroupId);
            setActiveSheet('details');
          },
        },
        {
          icon: 'share-variant',
          label: t('editor.shareAudio'),
          onPress: () => setActiveSheet('sharePicker'),
        },
        {
          icon: 'trash-can-outline',
          label: t('common.delete'),
          destructive: true,
          onPress: () => removeAudioGroup(actionsGroupId),
        },
      ]
    : [];

  const fileActionRows: ActionSheetRow[] = actionsFile
    ? [
        {
          icon: 'pencil-outline',
          label: t('action.rename'),
          onPress: () => {
            setRenameTargetGroupId(null);
            setRenameTargetFileUri(actionsFile.uri);
            setRenameValue(actionsFile.displayName);
            setActiveSheet('rename');
          },
        },
        {
          icon: 'share-variant',
          label: t('editor.shareFile'),
          onPress: () => void shareSpecificFile(actionsFile),
        },
        {
          icon: 'trash-can-outline',
          label: t('editor.remove'),
          destructive: true,
          onPress: () => {
            removeFile(actionsFile);
          },
        },
      ]
    : [];

  const overflowRows: ActionSheetRow[] = [
    {
      icon: 'content-copy',
      label: t('editor.copyText'),
      onPress: () => void copyTextContent(),
    },
    {
      icon: 'share-variant',
      label: t('editor.shareText'),
      onPress: () => void shareText(),
    },
    {
      icon: 'music-note',
      label: t('editor.shareAudio'),
      onPress: () => {
        if (audios.length > 0) {
          setActiveSheet('sharePicker');
        }
      },
    },
  ];

  if (isLoading) {
    return (
      <ScreenContainer>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <AppText variant="body" color={colors.textSecondary}>
            {t('common.loading')}
          </AppText>
        </View>
      </ScreenContainer>
    );
  }

  if (loadError) {
    return (
      <ScreenContainer>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: ui.space.lg, gap: ui.space.lg }}>
          <AppText variant="headline" color={colors.error} style={{ textAlign: 'center' }}>
            {t('editor.loadError')}
          </AppText>
          <PrimaryButton onPress={() => navigation.goBack()}>{t('common.back')}</PrimaryButton>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <EditorAttachments
        ref={editorAttachmentsRef}
        audioGroups={audioGroups}
        files={files}
        recordingActive={Boolean(recording)}
        recordingGroupId={appendTargetGroupId}
        recordingPaused={isRecordingPaused}
        onOpenGroupActions={openGroupActions}
        onOpenFile={openFile}
        onOpenFileActions={openFileActions}
        header={
          <>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={t('editor.titlePlaceholder')}
              placeholderTextColor={colors.textSecondary}
              style={{
                color: colors.text,
                fontSize: 28,
                fontWeight: language === 'bn' ? undefined : '700',
                fontFamily: getFontFamily(language, '700'),
                lineHeight: 36,
                paddingVertical: ui.space.sm,
              }}
            />
            {isReadingContent ? (
              <NoteContentView
                content={content}
                audioGroups={audioGroups}
                files={files}
                onPressAudio={(groupId) => void editorAttachmentsRef.current?.toggleGroupPlayback(groupId)}
                onPressFile={(file) => void openFile(file)}
              />
            ) : (
              <TextInput
                {...textInputProps}
                placeholder={t('editor.contentPlaceholder')}
                placeholderTextColor={colors.textSecondary}
                multiline
                scrollEnabled={false}
                textAlignVertical="top"
                onContentSizeChange={(event) => onContentSizeChange(event.nativeEvent.contentSize.height + 24)}
                style={{
                  minHeight: 230,
                  height: contentInputHeight,
                  color: colors.text,
                  fontFamily: getFontFamily(language, '400'),
                  fontSize: ui.type.headline.size,
                  lineHeight: 26,
                  paddingTop: ui.space.sm,
                }}
              />
            )}
          </>
        }
        footer={
          Platform.OS === 'android' ? (
            <AppText
              variant="caption"
              color={colors.textSecondary}
              style={{ marginTop: ui.space.sm }}
            >
              {t('editor.shareHint')}
            </AppText>
          ) : (
            <View />
          )
        }
        contentContainerStyle={{
          paddingHorizontal: ui.space.lg,
          paddingTop: insets.top + ui.space.sm + TOP_BAR_HEIGHT + ui.space.md,
          paddingBottom: 140 + Math.max(insets.bottom, 12),
        }}
      />

      <TopBar
        onBack={() => {
          if (!isAutoSavingRef.current) navigation.goBack();
        }}
        leading={
          <IconButton
            icon="home-outline"
            disabled={isSaving}
            accessibilityLabel={t('header.folders')}
            onPress={() => void goHome()}
          />
        }
      >
        <LanguageToggleButton />
        <IconButton
          icon={isReadingContent ? 'pencil-outline' : 'book-open-variant'}
          accessibilityLabel={t(isReadingContent ? 'editor.editMode' : 'editor.readMode')}
          onPress={() => setIsReadingContent((prev) => !prev)}
        />
        <IconButton
          icon="content-save-outline"
          disabled={saveDisabled}
          accessibilityLabel={t('editor.save')}
          onPress={() => void saveNote()}
        />
      </TopBar>

      <View
        style={{
          position: 'absolute',
          left: ui.space.lg,
          right: ui.space.lg,
          bottom: Math.max(insets.bottom, 10),
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {recording ? (
          <EditorRecordingBar
            recording={recording}
            isPaused={isRecordingPaused}
            appendGroupId={appendTargetGroupId}
            onTogglePause={() => void toggleRecordingPause()}
            onStop={stopRecordingHandler}
          />
        ) : attachmentKeyword !== undefined && !isReadingContent ? (
          <View style={[barShadow, { flex: 1 }]}>
            <GlassSurface
              radius={ui.radius.xl}
              contentStyle={{
                paddingHorizontal: ui.space.md,
                paddingVertical: ui.space.md,
                gap: ui.space.sm,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: ui.space.sm }}>
                <MaterialCommunityIcons name="at" size={18} color={colors.textSecondary} />
                <AppText variant="caption" color={colors.textSecondary} style={{ flex: 1 }}>
                  {t(
                    suggestedAttachments.length > 0
                      ? 'editor.attachmentSuggestions'
                      : 'editor.attachmentSuggestionsEmpty'
                  )}
                </AppText>
              </View>
              {suggestedAttachments.length > 0 ? (
                <ScrollView
                  style={{ maxHeight: 176 }}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <View style={{ gap: ui.space.sm }}>
                    {suggestedAttachments.map((tag) => (
                      <PressableScale
                        key={tag.tagId}
                        onPress={() => triggers.attachment.onSelect({ id: tag.tagId, name: tag.displayName })}
                        accessibilityRole="button"
                        accessibilityLabel={tag.displayName}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: ui.space.md,
                          backgroundColor: colors.surfaceVariant,
                          borderRadius: ui.radius.md,
                          paddingHorizontal: ui.space.md,
                          paddingVertical: ui.space.sm,
                        }}
                      >
                        <MaterialCommunityIcons
                          name={
                            tag.kind === 'audio'
                              ? 'waveform'
                              : (getFileIcon(tag.file.mimeType) as keyof typeof MaterialCommunityIcons.glyphMap)
                          }
                          size={20}
                          color={colors.primary}
                        />
                        <View style={{ flex: 1 }}>
                          <AppText variant="headline" numberOfLines={1}>
                            {tag.displayName}
                          </AppText>
                          <AppText variant="caption" color={colors.textSecondary}>
                            {tag.kind === 'audio'
                              ? tag.segmentCount > 1
                                ? t('editor.audioSegments', { count: tag.segmentCount })
                                : t('editor.attachmentKindAudio')
                              : isImageMimeType(tag.file.mimeType)
                                ? t('editor.attachmentKindImage')
                                : isPdfMimeType(tag.file.mimeType)
                                  ? t('editor.attachmentKindPdf')
                                  : t('editor.attachmentKindFile')}
                          </AppText>
                        </View>
                      </PressableScale>
                    ))}
                  </View>
                </ScrollView>
              ) : null}
            </GlassSurface>
          </View>
        ) : (
          <>
            <View style={barShadow}>
              <GlassSurface
                radius={ui.radius.pill}
                contentStyle={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: ui.space.sm,
                  padding: ui.space.sm,
                }}
              >
                <IconButton
                  icon="plus"
                  square
                  onPress={() => void importAudio()}
                  accessibilityLabel={t('editor.audioImport')}
                />
                <PressableScale
                  onPress={() => void startRecording()}
                  accessibilityRole="button"
                  accessibilityLabel={t('editor.recordStart')}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: colors.primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MaterialCommunityIcons name="microphone" size={22} color={colors.onPrimary} />
                </PressableScale>
                <IconButton
                  icon="paperclip"
                  onPress={() => void importFile()}
                  accessibilityLabel={t('editor.fileImport')}
                />
              </GlassSurface>
            </View>

            <View style={barShadow}>
              <GlassSurface
                radius={ui.radius.pill}
                contentStyle={{
                  height: TOP_BAR_HEIGHT,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: ui.space.lg,
                }}
              >
                <PressableScale
                  onPress={() => setActiveSheet('overflow')}
                  accessibilityRole="button"
                  accessibilityLabel={t('drawer.quickMenu')}
                  style={{
                    height: 40,
                    borderRadius: ui.radius.pill,
                    backgroundColor: colors.surfaceVariant,
                    paddingHorizontal: ui.space.lg,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: ui.space.xs,
                  }}
                >
                  <MaterialCommunityIcons name="dots-horizontal" size={22} color={colors.text} />
                </PressableScale>
              </GlassSurface>
            </View>
          </>
        )}
      </View>

      {activeSheet === 'overflow' ? (
        <ActionSheet visible onClose={closeSheet} rows={overflowRows} />
      ) : null}

      {activeSheet === 'groupActions' ? (
        <ActionSheet
          visible
          onClose={closeSheet}
          title={audioGroups.find((group) => group.groupId === actionsGroupId)?.displayName}
          rows={groupActionRows}
        />
      ) : null}

      {activeSheet === 'fileActions' ? (
        <ActionSheet
          visible
          onClose={closeSheet}
          title={actionsFile?.displayName}
          rows={fileActionRows}
        />
      ) : null}

      {activeSheet === 'rename' ? (
        <BottomSheet
          visible
          onClose={closeSheet}
          title={t(renameTargetFileUri ? 'editor.fileRenameTitle' : 'editor.renameTitle')}
        >
        <View style={{ paddingHorizontal: ui.space.lg, gap: ui.space.md }}>
          <TextInput
            value={renameValue}
            onChangeText={setRenameValue}
            placeholder={t(renameTargetFileUri ? 'editor.fileRenamePlaceholder' : 'editor.renamePlaceholder')}
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
                setRenameTargetGroupId(null);
                setRenameTargetFileUri(null);
                setRenameValue('');
                closeSheet();
              }}
              style={{ paddingHorizontal: ui.space.md, paddingVertical: ui.space.md }}
            >
              <AppText variant="headline" color={colors.textSecondary}>
                {t('common.cancel')}
              </AppText>
            </PressableScale>
            <View style={{ width: 132 }}>
              <PrimaryButton onPress={saveAttachmentRename}>{t('editor.renameSave')}</PrimaryButton>
            </View>
          </View>
        </View>
        </BottomSheet>
      ) : null}

      {activeSheet === 'sharePicker' ? (
        <BottomSheet
          visible
          onClose={closeSheet}
          title={t('editor.shareAudioPickerTitle')}
        >
        <ScrollView style={{ maxHeight: 360 }}>
          <View style={{ paddingHorizontal: ui.space.lg, gap: ui.space.sm }}>
            {audioGroups.flatMap((group, groupIndex) =>
              group.segments.map((segment, segmentIndex) => (
                <PressableScale
                  key={`${group.groupId}:${segment.portableId ?? segment.uri}`}
                  onPress={() => void shareSpecificAudio(segment)}
                  style={{
                    backgroundColor: colors.surfaceVariant,
                    borderRadius: ui.radius.md,
                    paddingVertical: ui.space.md,
                    paddingHorizontal: ui.space.md,
                  }}
                >
                  <AppText variant="headline">
                    {group.segments.length > 1
                      ? `${groupIndex + 1}. ${group.displayName} (${segmentIndex + 1}/${group.segments.length})`
                      : `${groupIndex + 1}. ${group.displayName}`}
                  </AppText>
                </PressableScale>
              ))
            )}
          </View>
        </ScrollView>
        </BottomSheet>
      ) : null}

      {activeSheet === 'details' ? (
        <BottomSheet
          visible
          onClose={closeSheet}
          title={t('editor.audioLocationTitle')}
        >
        <ScrollView style={{ maxHeight: 360 }}>
          <View style={{ paddingHorizontal: ui.space.lg, gap: ui.space.sm }}>
            {(audioGroups.find((group) => group.groupId === detailsTargetGroupId)?.segments ?? []).map(
              (segment, index) => (
                <View
                  key={segment.portableId ?? segment.uri}
                  style={{
                    backgroundColor: colors.surfaceVariant,
                    borderRadius: ui.radius.md,
                    paddingVertical: ui.space.md,
                    paddingHorizontal: ui.space.md,
                  }}
                >
                  <AppText variant="bodySmall" color={colors.textSecondary}>
                    {`${index + 1}. ${segment.uri}`}
                  </AppText>
                </View>
              )
            )}
          </View>
        </ScrollView>
        <View style={{ alignItems: 'flex-end', paddingHorizontal: ui.space.lg, paddingTop: ui.space.md }}>
          <PressableScale onPress={closeSheet} style={{ padding: ui.space.sm }}>
            <AppText variant="headline" color={colors.textSecondary}>
              {t('editor.audioLocationClose')}
            </AppText>
          </PressableScale>
        </View>
        </BottomSheet>
      ) : null}

      <Modal
        animationType="fade"
        transparent
        visible={viewingFileUri !== null}
        onRequestClose={() => setViewingFileUri(null)}
        statusBarTranslucent
      >
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <PressableScale
            onPress={() => setViewingFileUri(null)}
            accessibilityRole="button"
            accessibilityLabel={t('editor.close')}
            style={{
              position: 'absolute',
              top: Math.max(insets.top, 12),
              right: 16,
              zIndex: 10,
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: 'rgba(255,255,255,0.2)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MaterialCommunityIcons name="close" size={22} color="#FFF" />
          </PressableScale>

          {viewingFileUri ? (
            <PressableScale
              onPress={() => setViewingFileUri(null)}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
            >
              <Image
                source={{ uri: viewingFileUri }}
                style={{ width: screenWidth, height: screenHeight }}
                resizeMode="contain"
              />
            </PressableScale>
          ) : null}
        </View>
      </Modal>
    </ScreenContainer>
  );
};
