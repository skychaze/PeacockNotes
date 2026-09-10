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
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated as RNAnimated,
  Image,
  Modal,
  Platform,
  ScrollView,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated from 'react-native-reanimated';
import type { ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionSheet } from '../components/ActionSheet';
import type { ActionSheetRow } from '../components/ActionSheet';
import { AnimatedBars } from '../components/AnimatedBars';
import { AnimatedRing } from '../components/AnimatedRing';
import { AppText, getFontFamily } from '../components/AppText';
import { BottomSheet } from '../components/BottomSheet';
import { GlassSurface } from '../components/GlassSurface';
import { IconButton } from '../components/IconButton';
import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { PressableScale } from '../components/PressableScale';
import { PrimaryButton } from '../components/PrimaryButton';
import { ProgressFill } from '../components/ProgressFill';
import { ScreenContainer } from '../components/ScreenContainer';
import { TOP_BAR_HEIGHT, TopBar } from '../components/TopBar';
import { useEntrance } from '../components/entrance';
import { createNote, getNoteById, updateNote } from '../database/schema';
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
import { getFileExtension, getFileMimeType, isImageFile, getFileIcon } from '../utils/fileFormat';
import { deleteMediaFiles } from '../utils/mediaFiles';

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

const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60)
    .toString()
    .padStart(2, '0');
  const remainingSeconds = (safeSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
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

const formatDurationMillis = (millis: number) => formatDuration(Math.floor(Math.max(0, millis) / 1000));

type AudioGroup = {
  groupId: string;
  displayName: string;
  segments: NoteAudioDraft[];
};



export const NoteEditorScreen = () => {
  const route = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { colors } = useAppColors();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { t, language } = useLanguage();
  const entrance = useEntrance();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [audios, setAudios] = useState<NoteAudioDraft[]>([]);
  const [files, setFiles] = useState<NoteFileDraft[]>([]);
  const [viewingFileUri, setViewingFileUri] = useState<string | null>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [appendTargetGroupId, setAppendTargetGroupId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(Boolean(route.params.noteId));
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingGroupId, setPlayingGroupId] = useState<string | null>(null);
  const [playbackPositionMillis, setPlaybackPositionMillis] = useState(0);
  const [playbackDurationMillis, setPlaybackDurationMillis] = useState(0);
  const [contentInputHeight, setContentInputHeight] = useState(230);
  const [activeSheet, setActiveSheet] = useState<EditorSheet>('none');
  const [actionsGroupId, setActionsGroupId] = useState<string | null>(null);
  const [actionsFileIndex, setActionsFileIndex] = useState<number | null>(null);
  const [renameTargetGroupId, setRenameTargetGroupId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [detailsTargetGroupId, setDetailsTargetGroupId] = useState<string | null>(null);

  const soundRef = useRef<Audio.Sound | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const isFinalizingRecordingRef = useRef(false);
  const playbackQueueRef = useRef<{ segments: NoteAudioDraft[]; nextIndex: number; startedAtMillis: number } | null>(
    null
  );
  const isPlaybackStoppingRef = useRef(false);
  const pulseAnim = useRef(new RNAnimated.Value(1)).current;
  const equalizerA = useRef(new RNAnimated.Value(0.35)).current;
  const equalizerB = useRef(new RNAnimated.Value(0.65)).current;
  const equalizerC = useRef(new RNAnimated.Value(0.45)).current;
  const initialDraftRef = useRef<NoteDraft>({ title: '', content: '', audios: [], files: [] });
  const skipUnsavedWarningRef = useRef(false);
  const isAutoSavingRef = useRef(false);

  const { folderId, noteId } = route.params;
  const isEditMode = Boolean(noteId);
  const createDefaultAudioName = (order: number) => t('editor.audioDefaultName', { index: order });

  const closeSheet = () => setActiveSheet('none');

  useEffect(() => {
    const loadNote = async () => {
      if (!noteId) {
        return;
      }
      try {
        const note = await getNoteById(noteId);
        if (!note) {
          Alert.alert(t('editor.notFoundTitle'), t('editor.notFoundBody'));
          navigation.goBack();
          return;
        }

        const loadedAudios = (note.audios ?? []).map((audio, index) => ({
          uri: audio.uri,
          displayName:
            audio.displayName?.trim() || createDefaultAudioName(audio.orderIndex || index + 1),
          groupId: audio.groupId,
          segmentIndex: audio.segmentIndex,
        }));

        const loadedFiles = (note.files ?? []).map((file) => ({
          uri: file.uri,
          displayName: file.displayName,
          mimeType: file.mimeType,
        }));

        setTitle(note.title);
        setContent(note.content);
        setAudios(loadedAudios);
        setFiles(loadedFiles);
        initialDraftRef.current = {
          title: note.title,
          content: note.content,
          audios: loadedAudios.map((audio) => ({ ...audio })),
          files: loadedFiles.map((file) => ({ ...file })),
        };
      } catch (error) {
        console.warn('Failed to load note:', error);
        Alert.alert(t('common.error'), t('editor.loadError'));
      } finally {
        setIsLoading(false);
      }
    };

    void loadNote();
  }, [navigation, noteId]);

  useEffect(() => {
    if (!noteId) {
      initialDraftRef.current = { title: '', content: '', audios: [], files: [] };
    }
  }, [noteId]);

  useEffect(() => {
    if (!recording) {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      return;
    }

    if (isRecordingPaused) {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      return;
    }

    const pulseLoop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulseAnim, {
          toValue: 1.45,
          duration: 650,
          useNativeDriver: true,
        }),
        RNAnimated.timing(pulseAnim, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();

    const timer = setInterval(() => {
      setRecordSeconds((prev) => prev + 1);
    }, 1000);

    return () => {
      pulseLoop.stop();
      clearInterval(timer);
    };
  }, [isRecordingPaused, recording, pulseAnim]);

  useEffect(() => {
    if (!isPlaying) {
      equalizerA.stopAnimation();
      equalizerB.stopAnimation();
      equalizerC.stopAnimation();
      equalizerA.setValue(0.35);
      equalizerB.setValue(0.65);
      equalizerC.setValue(0.45);
      return;
    }

    const animateBar = (value: RNAnimated.Value, firstPeak: number, secondPeak: number, delay: number) =>
      RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.delay(delay),
          RNAnimated.timing(value, {
            toValue: firstPeak,
            duration: 220,
            useNativeDriver: false,
          }),
          RNAnimated.timing(value, {
            toValue: 0.25,
            duration: 180,
            useNativeDriver: false,
          }),
          RNAnimated.timing(value, {
            toValue: secondPeak,
            duration: 250,
            useNativeDriver: false,
          }),
          RNAnimated.timing(value, {
            toValue: 0.38,
            duration: 180,
            useNativeDriver: false,
          }),
        ])
      );

    const loopA = animateBar(equalizerA, 1, 0.8, 0);
    const loopB = animateBar(equalizerB, 0.88, 1, 70);
    const loopC = animateBar(equalizerC, 0.75, 0.92, 140);

    loopA.start();
    loopB.start();
    loopC.start();

    return () => {
      loopA.stop();
      loopB.stop();
      loopC.stop();
    };
  }, [equalizerA, equalizerB, equalizerC, isPlaying]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    return () => {
      const activeRecording = recordingRef.current;
      if (activeRecording) {
        activeRecording.stopAndUnloadAsync().catch(() => undefined);
      }
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => undefined);
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

  const saveNote = async () => {
    const audiosForSave = await flushActiveRecordingForSave();
    if (!audiosForSave) {
      return;
    }

    if (!title.trim()) {
      Alert.alert(t('editor.missingTitleTitle'), t('editor.missingTitleBody'));
      return;
    }

    const draft: NoteDraft = {
      title: title.trim(),
      content,
      audios: audiosForSave,
      files,
    };

    try {
      setIsSaving(true);
      if (noteId) {
        await updateNote(noteId, draft);
      } else {
        await createNote(folderId, draft);
      }

      initialDraftRef.current = {
        title: draft.title,
        content: draft.content,
        audios: draft.audios.map((audio) => ({ ...audio })),
        files: draft.files.map((file) => ({ ...file })),
      };

      skipUnsavedWarningRef.current = true;
      navigation.goBack();
    } catch (error) {
      console.warn('Failed to save note:', error);
      Alert.alert(t('common.error'), t('editor.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  const autoSaveBeforeExit = async () => {
    const audiosForSave = await flushActiveRecordingForSave();
    if (!audiosForSave) {
      return false;
    }

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

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

    try {
      setIsSaving(true);
      if (noteId) {
        await updateNote(noteId, draft);
      } else {
        await createNote(folderId, draft);
      }

      initialDraftRef.current = {
        title: draft.title,
        content: draft.content,
        audios: draft.audios.map((audio) => ({ ...audio })),
        files: draft.files.map((file) => ({ ...file })),
      };
      return true;
    } catch (error) {
      console.warn('Failed to auto-save note before exit:', error);
      Alert.alert(t('common.error'), t('editor.autoSaveError'));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (skipUnsavedWarningRef.current || !hasUnsavedChanges || isAutoSavingRef.current) {
        return;
      }

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

  const removeFile = (index: number) => {
    const file = files[index];
    const wasPersisted = initialDraftRef.current.files.some((item) => item.uri === file?.uri);
    if (file && !wasPersisted) {
      void deleteMediaFiles([file.uri]);
    }
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const shareSpecificFile = async (file: NoteFileDraft) => {
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
  };

  const openFile = async (file: NoteFileDraft) => {
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
  };

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
      setRecordSeconds(0);
      setAppendTargetGroupId(null);
      return uri ? { uri, appendGroupId } : null;
    } finally {
      isFinalizingRecordingRef.current = false;
      void resetAudioModeForPlayback();
    }
  };

  const startRecording = async () => {
    if (recording || isFinalizingRecordingRef.current) {
      return;
    }

    try {
      if (soundRef.current) {
        await stopCurrentPlayback();
      }

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
      setAppendTargetGroupId(null);
      setIsRecordingPaused(false);
      setRecordSeconds(0);
      setRecording(newRecording);
    } catch (error) {
      console.warn('Failed to start recording:', error);
      void resetAudioModeForPlayback();
      Alert.alert(t('common.error'), t('editor.recordStartError'));
    }
  };

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
    if (recording || isFinalizingRecordingRef.current) {
      return;
    }

    const targetGroup = audioGroups.find((group) => group.groupId === groupId);
    if (!targetGroup) {
      return;
    }

    try {
      if (soundRef.current) {
        await stopCurrentPlayback();
      }

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
      setRecordSeconds(0);
      setRecording(newRecording);
    } catch (error) {
      console.warn('Failed to start append recording:', error);
      void resetAudioModeForPlayback();
      Alert.alert(t('common.error'), t('editor.recordStartError'));
    }
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

  const resetPlaybackState = () => {
    playbackQueueRef.current = null;
    setIsPlaying(false);
    setPlayingGroupId(null);
    setPlaybackPositionMillis(0);
    setPlaybackDurationMillis(0);
  };

  const stopCurrentPlayback = async () => {
    isPlaybackStoppingRef.current = true;
    try {
      const currentSound = soundRef.current;
      if (currentSound) {
        await currentSound.stopAsync();
        await currentSound.unloadAsync();
      }
    } catch {
      // ignore
    } finally {
      soundRef.current = null;
      resetPlaybackState();
      isPlaybackStoppingRef.current = false;
    }
  };

  const playSegmentQueue = async (groupId: string) => {
    const queue = playbackQueueRef.current;
    if (!queue) {
      return;
    }

    if (queue.nextIndex >= queue.segments.length) {
      await stopCurrentPlayback();
      return;
    }

    const segment = queue.segments[queue.nextIndex];
    queue.nextIndex += 1;

    const currentSound = soundRef.current;
    if (currentSound) {
      await currentSound.unloadAsync().catch(() => undefined);
      soundRef.current = null;
    }

    const { sound } = await Audio.Sound.createAsync({ uri: segment.uri });
    soundRef.current = sound;

    sound.setOnPlaybackStatusUpdate((status) => {
      if (!status.isLoaded) {
        return;
      }

      const elapsed = queue.startedAtMillis + status.positionMillis;
      setPlaybackPositionMillis(elapsed);
      setPlaybackDurationMillis(queue.startedAtMillis + (status.durationMillis ?? 0));

      if (status.didJustFinish && !isPlaybackStoppingRef.current) {
        queue.startedAtMillis += status.durationMillis ?? 0;
        void playSegmentQueue(groupId).catch(async (error) => {
          console.warn('Failed to continue audio queue:', error);
          await stopCurrentPlayback();
          Alert.alert(t('common.error'), t('editor.audioPlayError'));
        });
      }
    });

    await sound.playAsync();
  };

  const togglePlayback = async (groupId: string, segments: NoteAudioDraft[]) => {
    try {
      if (soundRef.current && isPlaying && playingGroupId === groupId) {
        await stopCurrentPlayback();
        return;
      }

      if (soundRef.current) {
        await stopCurrentPlayback();
      }

      if (segments.length === 0) {
        return;
      }

      playbackQueueRef.current = {
        segments,
        nextIndex: 0,
        startedAtMillis: 0,
      };
      setIsPlaying(true);
      setPlayingGroupId(groupId);
      setPlaybackPositionMillis(0);
      setPlaybackDurationMillis(0);

      await playSegmentQueue(groupId);
    } catch (error) {
      console.warn('Failed to play audio:', error);
      await stopCurrentPlayback();
      Alert.alert(t('common.error'), t('editor.audioPlayError'));
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
      void deleteMediaFiles(sessionUris);
    }

    setAudios((prev) => prev.filter((audio) => audio.groupId !== groupId));

    if (playingGroupId === groupId) {
      void stopCurrentPlayback();
    }
  };

  const startRenameAudioGroup = (groupId: string) => {
    const group = audioGroups.find((item) => item.groupId === groupId);
    setRenameTargetGroupId(groupId);
    setRenameValue(group?.displayName ?? '');
    setActiveSheet('rename');
  };

  const saveAudioRename = () => {
    if (!renameTargetGroupId) {
      return;
    }

    const trimmed = renameValue.trim();
    if (!trimmed) {
      Alert.alert(t('editor.renameMissingTitle'), t('editor.renameMissingBody'));
      return;
    }

    setAudios((prev) =>
      prev.map((audio) => (audio.groupId === renameTargetGroupId ? { ...audio, displayName: trimmed } : audio))
    );
    setRenameTargetGroupId(null);
    setRenameValue('');
    closeSheet();
  };

  const copyTextContent = async () => {
    try {
      await Clipboard.setStringAsync(content);
      Alert.alert(t('editor.copySuccessTitle'), t('editor.copySuccessBody'));
    } catch (error) {
      console.warn('Failed to copy text:', error);
      Alert.alert(t('common.error'), t('editor.copyError'));
    }
  };

  const shareText = async () => {
    try {
      const textForSharing = content.trim() || title.trim();
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

  const saveProgressRatio =
    isPlaying && playbackDurationMillis > 0
      ? Math.min(1, Math.max(0, playbackPositionMillis / playbackDurationMillis))
      : 0;

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

  const actionsFile = actionsFileIndex !== null ? files[actionsFileIndex] : undefined;
  const fileActionRows: ActionSheetRow[] = actionsFile
    ? [
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
            if (actionsFileIndex !== null) {
              removeFile(actionsFileIndex);
            }
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

  return (
    <ScreenContainer>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: ui.space.lg,
          paddingTop: insets.top + ui.space.sm + TOP_BAR_HEIGHT + ui.space.md,
          paddingBottom: 140 + Math.max(insets.bottom, 12),
        }}
        keyboardShouldPersistTaps="handled"
      >
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

        <TextInput
          value={content}
          onChangeText={setContent}
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

        <AppText variant="headline" style={{ marginTop: ui.space.lg }}>
          {t('editor.audioSection')}
        </AppText>

        <View style={{ gap: ui.space.sm, marginTop: ui.space.sm }}>
          {audioGroups.map((group, index) => {
            const isCurrent = isPlaying && playingGroupId === group.groupId;
            const isAppendRecording = recording && appendTargetGroupId === group.groupId;
            const groupProgress = isCurrent ? saveProgressRatio : 0;
            return (
              <Animated.View
                key={`${group.groupId}-${index}`}
                entering={entrance(index)}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: ui.radius.lg,
                  padding: ui.space.lg,
                  gap: ui.space.sm,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: ui.space.md }}>
                  <PressableScale
                    onPress={() => void togglePlayback(group.groupId, group.segments)}
                    accessibilityRole="button"
                    accessibilityLabel={isCurrent ? t('editor.audioStop') : t('editor.audioPlay')}
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: colors.primary,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <MaterialCommunityIcons
                      name={isCurrent ? 'stop' : 'play'}
                      size={22}
                      color={colors.onPrimary}
                    />
                  </PressableScale>

                  <View style={{ flex: 1 }}>
                    <AppText variant="headline" numberOfLines={1}>
                      {group.displayName}
                    </AppText>
                    <AppText variant="caption" color={colors.textSecondary}>
                      {isCurrent && playbackDurationMillis > 0
                        ? t('editor.playingTimer', {
                            elapsed: formatDurationMillis(playbackPositionMillis),
                            total: formatDurationMillis(playbackDurationMillis),
                          })
                        : t('editor.audioSegments', { count: group.segments.length })}
                    </AppText>
                  </View>

                  {isCurrent ? <AnimatedBars playing color={colors.primary} /> : null}

                  <IconButton
                    icon="dots-vertical"
                    onPress={() => {
                      setActionsGroupId(group.groupId);
                      setActiveSheet('groupActions');
                    }}
                    accessibilityLabel={t('editor.audioDetails')}
                  />
                </View>

                {isCurrent ? (
                  <ProgressFill
                    progress={groupProgress}
                    trackColor={colors.surfaceVariant}
                    fillColor={colors.primary}
                  />
                ) : null}

                {isAppendRecording && isRecordingPaused ? (
                  <View
                    style={{
                      alignSelf: 'flex-start',
                      paddingHorizontal: ui.space.sm,
                      paddingVertical: 3,
                      borderRadius: ui.radius.pill,
                      backgroundColor: colors.surfaceVariant,
                    }}
                  >
                    <AppText variant="caption" color={colors.textSecondary}>
                      {t('editor.pausedBadge')}
                    </AppText>
                  </View>
                ) : null}

                {isAppendRecording ? (
                  <AppText variant="caption" color={colors.error}>
                    {isRecordingPaused
                      ? t('editor.appendingPaused', { time: formatDuration(recordSeconds) })
                      : t('editor.appending', { time: formatDuration(recordSeconds) })}
                  </AppText>
                ) : null}
              </Animated.View>
            );
          })}
        </View>

        <AppText variant="headline" style={{ marginTop: ui.space.lg }}>
          {t('editor.fileSection')}
        </AppText>

        <View style={{ gap: ui.space.sm, marginTop: ui.space.sm }}>
          {files.map((file, index) => {
            const iconName = getFileIcon(file.mimeType) as keyof typeof MaterialCommunityIcons.glyphMap;
            const isImage = isImageFile(file.mimeType, file.displayName, file.uri);
            return (
              <Animated.View
                key={`${file.uri}-${index}`}
                entering={entrance(index)}
                style={{
                  backgroundColor: colors.surfaceVariant,
                  borderRadius: ui.radius.md,
                  paddingHorizontal: ui.space.md,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: ui.space.md,
                }}
              >
                <PressableScale
                  onPress={() => void openFile(file)}
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: ui.space.md,
                    paddingVertical: ui.space.md,
                  }}
                >
                  {isImage ? (
                    <Image
                      source={{ uri: file.uri }}
                      style={{ width: 44, height: 44, borderRadius: ui.radius.sm }}
                      resizeMode="cover"
                    />
                  ) : (
                    <MaterialCommunityIcons name={iconName} size={22} color={colors.textSecondary} />
                  )}
                  <AppText
                    variant="bodySmall"
                    numberOfLines={2}
                    style={{ flex: 1 }}
                  >
                    {file.displayName}
                  </AppText>
                </PressableScale>
                <IconButton
                  icon="dots-vertical"
                  size={20}
                  onPress={() => {
                    setActionsFileIndex(index);
                    setActiveSheet('fileActions');
                  }}
                />
              </Animated.View>
            );
          })}
        </View>

        {Platform.OS === 'android' ? (
          <AppText
            variant="caption"
            color={colors.textSecondary}
            style={{ marginTop: ui.space.sm }}
          >
            {t('editor.shareHint')}
          </AppText>
        ) : null}
      </ScrollView>

      <TopBar onBack={() => navigation.goBack()}>
        <LanguageToggleButton />
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
          <View style={[barShadow, { flex: 1 }]}>
            <GlassSurface radius={ui.radius.xl} contentStyle={{ padding: ui.space.sm }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: ui.space.md,
                  paddingHorizontal: ui.space.sm,
                }}
              >
                <AnimatedRing
                  progress={1}
                  size={36}
                  strokeWidth={3}
                  color={colors.primary}
                  trackColor={colors.surfaceVariant}
                >
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <RNAnimated.View
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 7,
                        backgroundColor: colors.error,
                        transform: [{ scale: pulseAnim }],
                      }}
                    />
                  </View>
                </AnimatedRing>
                <AppText variant="caption" color={colors.textSecondary} style={{ flex: 1 }}>
                  {isRecordingPaused
                    ? appendTargetGroupId
                      ? t('editor.appendingPaused', { time: formatDuration(recordSeconds) })
                      : t('editor.recordPaused', { time: formatDuration(recordSeconds) })
                    : appendTargetGroupId
                      ? t('editor.appending', { time: formatDuration(recordSeconds) })
                      : t('editor.recording', { time: formatDuration(recordSeconds) })}
                </AppText>
                <IconButton
                  icon={isRecordingPaused ? 'play' : 'pause'}
                  onPress={() => void toggleRecordingPause()}
                  accessibilityLabel={isRecordingPaused ? t('editor.recordResume') : t('editor.recordPause')}
                />
                <IconButton
                  icon="stop"
                  danger
                  onPress={stopRecordingHandler}
                  accessibilityLabel={t('editor.recordStop')}
                />
              </View>
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

      <ActionSheet
        visible={activeSheet === 'overflow'}
        onClose={closeSheet}
        rows={overflowRows}
      />

      <ActionSheet
        visible={activeSheet === 'groupActions'}
        onClose={closeSheet}
        title={audioGroups.find((group) => group.groupId === actionsGroupId)?.displayName}
        rows={groupActionRows}
      />

      <ActionSheet
        visible={activeSheet === 'fileActions'}
        onClose={closeSheet}
        title={actionsFile?.displayName}
        rows={fileActionRows}
      />

      <BottomSheet
        visible={activeSheet === 'rename'}
        onClose={closeSheet}
        title={t('editor.renameTitle')}
      >
        <View style={{ paddingHorizontal: ui.space.lg, gap: ui.space.md }}>
          <TextInput
            value={renameValue}
            onChangeText={setRenameValue}
            placeholder={t('editor.renamePlaceholder')}
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
              <PrimaryButton onPress={saveAudioRename}>{t('editor.renameSave')}</PrimaryButton>
            </View>
          </View>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={activeSheet === 'sharePicker'}
        onClose={closeSheet}
        title={t('editor.shareAudioPickerTitle')}
      >
        <ScrollView style={{ maxHeight: 360 }}>
          <View style={{ paddingHorizontal: ui.space.lg, gap: ui.space.sm }}>
            {audioGroups.flatMap((group, groupIndex) =>
              group.segments.map((segment, segmentIndex) => (
                <PressableScale
                  key={`${group.groupId}-${segmentIndex}`}
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

      <BottomSheet
        visible={activeSheet === 'details'}
        onClose={closeSheet}
        title={t('editor.audioLocationTitle')}
      >
        <ScrollView style={{ maxHeight: 360 }}>
          <View style={{ paddingHorizontal: ui.space.lg, gap: ui.space.sm }}>
            {(audioGroups.find((group) => group.groupId === detailsTargetGroupId)?.segments ?? []).map(
              (segment, index) => (
                <View
                  key={`${segment.uri}-${index}`}
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
