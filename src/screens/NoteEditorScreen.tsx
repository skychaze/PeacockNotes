import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { createNote, getNoteById, updateNote } from '../database/schema';
import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { useLanguage } from '../i18n/LanguageContext';
import { getContrastColor } from '../theme/contrast';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { NoteAudioDraft, NoteDraft } from '../types/models';
import type { RootStackParamList } from '../types/navigation';
import {
  getBestAudioExtension,
  getMimeTypeForAudioExtension,
  getPreferredShareExtension,
  isShareFriendlyAudioExtension,
} from '../utils/audioFormat';

type Route = RouteProp<RootStackParamList, 'NoteEditor'>;
type Navigation = NativeStackNavigationProp<RootStackParamList, 'NoteEditor'>;

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

const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60)
    .toString()
    .padStart(2, '0');
  const remainingSeconds = (safeSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
};

const createAudioGroupId = () => `audio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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
  const { t, language } = useLanguage();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [audios, setAudios] = useState<NoteAudioDraft[]>([]);
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
  const [renameTargetGroupId, setRenameTargetGroupId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isShareAudioPickerVisible, setIsShareAudioPickerVisible] = useState(false);
  const [detailsTargetGroupId, setDetailsTargetGroupId] = useState<string | null>(null);

  const soundRef = useRef<Audio.Sound | null>(null);
  const playbackQueueRef = useRef<{ segments: NoteAudioDraft[]; nextIndex: number; startedAtMillis: number } | null>(
    null
  );
  const isPlaybackStoppingRef = useRef(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const equalizerA = useRef(new Animated.Value(0.35)).current;
  const equalizerB = useRef(new Animated.Value(0.65)).current;
  const equalizerC = useRef(new Animated.Value(0.45)).current;
  const initialDraftRef = useRef<NoteDraft>({ title: '', content: '', audios: [] });
  const skipUnsavedWarningRef = useRef(false);
  const isAutoSavingRef = useRef(false);

  const { folderId, noteId } = route.params;
  const isEditMode = Boolean(noteId);
  const createDefaultAudioName = (order: number) => t('editor.audioDefaultName', { index: order });

  useLayoutEffect(() => {
    navigation.setOptions({
      title: isEditMode ? t('header.editNote') : t('header.newNote'),
      headerRight: () => <LanguageToggleButton />,
    });
  }, [isEditMode, navigation, t, language]);

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

        setTitle(note.title);
        setContent(note.content);
        setAudios(loadedAudios);
        initialDraftRef.current = {
          title: note.title,
          content: note.content,
          audios: loadedAudios.map((audio) => ({ ...audio })),
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
      initialDraftRef.current = { title: '', content: '', audios: [] };
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

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.45,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
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

    const animateBar = (value: Animated.Value, firstPeak: number, secondPeak: number, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: firstPeak,
            duration: 220,
            useNativeDriver: false,
          }),
          Animated.timing(value, {
            toValue: 0.25,
            duration: 180,
            useNativeDriver: false,
          }),
          Animated.timing(value, {
            toValue: secondPeak,
            duration: 250,
            useNativeDriver: false,
          }),
          Animated.timing(value, {
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
    return () => {
      if (recording) {
        recording.stopAndUnloadAsync().catch(() => undefined);
      }
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => undefined);
      }
    };
  }, [recording]);

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

    return audios.some(
      (audio, index) =>
        audio.uri !== initial.audios[index]?.uri ||
        audio.displayName !== initial.audios[index]?.displayName ||
        audio.groupId !== initial.audios[index]?.groupId ||
        Number(audio.segmentIndex ?? 1) !== Number(initial.audios[index]?.segmentIndex ?? 1)
    );
  }, [audios, content, title]);

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

    if (!trimmedTitle && !trimmedContent && audiosForSave.length === 0) {
      return true;
    }

    const autoTitle = trimmedTitle || trimmedContent.slice(0, 36) || t('editor.autoTitle');
    const draft: NoteDraft = {
      title: autoTitle,
      content,
      audios: audiosForSave,
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

  const startRecording = async () => {
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
      Alert.alert(t('common.error'), t('editor.recordStartError'));
    }
  };

  const stopRecording = async () => {
    if (!recording) {
      return;
    }

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      setIsRecordingPaused(false);
      setRecordSeconds(0);

      if (!uri) {
        return;
      }

      const directory = await ensureAudioFolder();
      const serial = audios.length + 1;
      const targetPath = `${directory}/${Date.now()}_${serial}_record.m4a`;
      await FileSystem.copyAsync({ from: uri, to: targetPath });
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
    if (recording) {
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
      Alert.alert(t('common.error'), t('editor.recordStartError'));
    }
  };

  const stopAppendRecording = async (groupId: string) => {
    if (!recording || appendTargetGroupId !== groupId) {
      return;
    }

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      setIsRecordingPaused(false);
      setRecordSeconds(0);
      setAppendTargetGroupId(null);

      if (!uri) {
        return;
      }

      const targetGroup = audioGroups.find((group) => group.groupId === groupId);
      if (!targetGroup) {
        return;
      }

      const directory = await ensureAudioFolder();
      const serial = audios.length + 1;
      const targetPath = `${directory}/${Date.now()}_${serial}_append.m4a`;
      await FileSystem.copyAsync({ from: uri, to: targetPath });
      appendAudio(targetPath, targetGroup.displayName, {
        groupId,
        segmentIndex: targetGroup.segments.length + 1,
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

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      const activeAppendGroupId = appendTargetGroupId;

      setRecording(null);
      setIsRecordingPaused(false);
      setRecordSeconds(0);
      setAppendTargetGroupId(null);

      if (!uri) {
        return audios;
      }

      const directory = await ensureAudioFolder();
      const serial = audios.length + 1;
      const targetPath = `${directory}/${Date.now()}_${serial}_${activeAppendGroupId ? 'append' : 'record'}.m4a`;
      await FileSystem.copyAsync({ from: uri, to: targetPath });

      let nextAudios: NoteAudioDraft[] = audios;

      if (activeAppendGroupId) {
        const targetSegments = audios.filter((audio) => audio.groupId === activeAppendGroupId);
        const nextSegmentIndex =
          targetSegments.reduce((max, audio) => Math.max(max, Number(audio.segmentIndex ?? 1)), 0) + 1;
        const displayName = targetSegments[0]?.displayName || createDefaultAudioName(audioGroups.length + 1);

        nextAudios = [
          ...audios,
          {
            uri: targetPath,
            displayName,
            groupId: activeAppendGroupId,
            segmentIndex: nextSegmentIndex,
          },
        ];
      } else {
        const uniqueGroupCount = new Set(audios.map((audio) => audio.groupId).filter(Boolean)).size;
        nextAudios = [
          ...audios,
          {
            uri: targetPath,
            displayName: createDefaultAudioName(uniqueGroupCount + 1),
            groupId: createAudioGroupId(),
            segmentIndex: 1,
          },
        ];
      }

      setAudios(nextAudios);
      return nextAudios;
    } catch (error) {
      console.warn('Failed to finalize recording before save:', error);
      Alert.alert(t('common.error'), t('editor.recordStopError'));
      return null;
    }
  };

  const toggleRecordingPause = async () => {
    if (!recording) {
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
    setAudios((prev) => prev.filter((audio) => audio.groupId !== groupId));

    if (playingGroupId === groupId) {
      void stopCurrentPlayback();
    }
  };

  const startRenameAudioGroup = (groupId: string) => {
    const group = audioGroups.find((item) => item.groupId === groupId);
    setRenameTargetGroupId(groupId);
    setRenameValue(group?.displayName ?? '');
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

      await Clipboard.setStringAsync(content);

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
      setIsShareAudioPickerVisible(false);
    } catch (error) {
      console.warn('Failed to share audio:', error);
      Alert.alert(t('common.error'), t('editor.shareAudioError'));
    }
  };

  const onContentSizeChange = (height: number) => {
    const minHeight = 230;
    const maxHeight = 1600;
    setContentInputHeight(Math.min(maxHeight, Math.max(minHeight, Math.ceil(height))));
  };

  const actionTextOnPrimary = getContrastColor(colors.primary, colors.text, '#FFFFFF');
  const actionTextOnAccent = getContrastColor(colors.accent, colors.text, '#FFFFFF');
  const iconOnCard = getContrastColor(colors.card, colors.text, '#FFFFFF');
  const textOnSecondary = getContrastColor(colors.secondary, '#0B1320', '#FFFFFF');

  if (isLoading) {
    return (
      <ScreenContainer>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.textSecondary, fontFamily: 'NotoSansBengali', fontSize: ui.font.md }}>
            {t('common.loading')}
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: ui.space.md,
          paddingTop: ui.space.sm,
          paddingBottom: 120 + Math.max(insets.bottom, 12),
        }}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={t('editor.titlePlaceholder')}
          placeholderTextColor={colors.textSecondary}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: ui.radius.md,
            backgroundColor: colors.card,
            color: colors.text,
            paddingHorizontal: 11,
            paddingVertical: 10,
            fontFamily: 'NotoSansBengali',
            fontSize: ui.font.lg,
            lineHeight: 22,
          }}
        />

        <View
          style={{
            marginTop: ui.space.sm,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: ui.radius.md,
            backgroundColor: colors.card,
            paddingTop: 8,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 8 }}>
            <Pressable
              onPress={copyTextContent}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 6,
              }}
            >
              <MaterialCommunityIcons name="content-copy" size={18} color={iconOnCard} />
              <Text style={{ color: iconOnCard, fontFamily: 'NotoSansBengali', fontSize: 14 }}>
                {t('editor.copy')}
              </Text>
            </Pressable>
          </View>

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
              paddingHorizontal: 11,
              paddingBottom: 12,
              fontFamily: 'NotoSansBengali',
              fontSize: ui.font.lg,
              lineHeight: 29,
            }}
          />
        </View>

        <View
          style={{
            marginTop: ui.space.md,
            borderRadius: ui.radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            padding: ui.space.sm,
            gap: ui.space.sm,
          }}
        >
          <Text style={{ color: colors.text, fontFamily: 'NotoSansBengali', fontSize: ui.font.lg }}>
            {t('editor.audioSection')}
          </Text>

          {recording ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
              <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
                <Animated.View
                  style={{
                    position: 'absolute',
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    backgroundColor: colors.error,
                    opacity: 0.3,
                    transform: [{ scale: pulseAnim }],
                  }}
                />
                <View
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 5,
                    backgroundColor: colors.error,
                  }}
                />
              </View>
              <Text style={{ color: colors.error, fontFamily: 'NotoSansBengali', fontSize: ui.font.md }}>
                {isRecordingPaused
                  ? appendTargetGroupId
                    ? t('editor.appendingPaused', { time: formatDuration(recordSeconds) })
                    : t('editor.recordPaused', { time: formatDuration(recordSeconds) })
                  : appendTargetGroupId
                    ? t('editor.appending', { time: formatDuration(recordSeconds) })
                    : t('editor.recording', { time: formatDuration(recordSeconds) })}
              </Text>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <Pressable
              onPress={
                recording
                  ? appendTargetGroupId
                    ? () => stopAppendRecording(appendTargetGroupId)
                    : stopRecording
                  : startRecording
              }
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: ui.radius.sm,
                backgroundColor: recording ? colors.error : colors.primary,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <MaterialCommunityIcons
                name={recording ? 'stop' : 'microphone'}
                size={18}
                color={recording ? '#FFFFFF' : actionTextOnPrimary}
              />
              <Text
                style={{
                  color: recording ? '#FFFFFF' : actionTextOnPrimary,
                  fontFamily: 'NotoSansBengali',
                  fontSize: ui.font.md,
                }}
              >
                {recording
                  ? appendTargetGroupId
                    ? t('editor.appendStop')
                    : t('editor.recordStop')
                  : t('editor.recordStart')}
              </Text>
            </Pressable>

            {recording ? (
              <Pressable
                onPress={toggleRecordingPause}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: ui.radius.sm,
                  backgroundColor: colors.secondary,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <MaterialCommunityIcons
                  name={isRecordingPaused ? 'play' : 'pause'}
                  size={18}
                  color={textOnSecondary}
                />
                <Text style={{ color: textOnSecondary, fontFamily: 'NotoSansBengali', fontSize: ui.font.md }}>
                  {isRecordingPaused ? t('editor.recordResume') : t('editor.recordPause')}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={importAudio}
              disabled={Boolean(recording)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: ui.radius.sm,
                backgroundColor: colors.accent,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                opacity: recording ? 0.5 : 1,
              }}
            >
              <MaterialCommunityIcons name="file-music" size={18} color={actionTextOnAccent} />
              <Text style={{ color: actionTextOnAccent, fontFamily: 'NotoSansBengali', fontSize: ui.font.md }}>
                {t('editor.audioImport')}
              </Text>
            </Pressable>
          </View>

          {audioGroups.length > 0 ? (
            <View style={{ gap: 8 }}>
              {audioGroups.map((group, index) => {
                const isCurrent = isPlaying && playingGroupId === group.groupId;
                const isAppendRecording = recording && appendTargetGroupId === group.groupId;
                const isAnotherRecordingActive = Boolean(recording && appendTargetGroupId !== group.groupId);
                return (
                  <View
                    key={`${group.groupId}-${index}`}
                    style={{
                      borderRadius: ui.radius.sm,
                      borderWidth: 1,
                      borderColor: colors.border,
                      padding: 10,
                      gap: 10,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: colors.text, fontFamily: 'NotoSansBengali', fontSize: ui.font.md }}>
                        {`${index + 1}. ${group.displayName}`}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {isAppendRecording && isRecordingPaused ? (
                          <View
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                              borderRadius: 999,
                              backgroundColor: colors.secondary,
                            }}
                          >
                            <Text style={{ color: textOnSecondary, fontFamily: 'NotoSansBengali', fontSize: 12 }}>
                              {t('editor.pausedBadge')}
                            </Text>
                          </View>
                        ) : null}
                        <Pressable onPress={() => startRenameAudioGroup(group.groupId)} style={{ padding: 4 }}>
                          <MaterialCommunityIcons name="pencil-outline" size={18} color={iconOnCard} />
                        </Pressable>
                      </View>
                    </View>

                    <Text
                      style={{
                        color: colors.textSecondary,
                        fontFamily: 'NotoSansBengali',
                        fontSize: ui.font.xs,
                      }}
                    >
                      {t('editor.audioSegments', { count: group.segments.length })}
                    </Text>

                    {isCurrent ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 16 }}>
                          <Animated.View
                            style={{
                              width: 4,
                              height: equalizerA.interpolate({ inputRange: [0, 1], outputRange: [4, 16] }),
                              borderRadius: 2,
                              backgroundColor: colors.primary,
                            }}
                          />
                          <Animated.View
                            style={{
                              width: 4,
                              height: equalizerB.interpolate({ inputRange: [0, 1], outputRange: [4, 16] }),
                              borderRadius: 2,
                              backgroundColor: colors.primary,
                            }}
                          />
                          <Animated.View
                            style={{
                              width: 4,
                              height: equalizerC.interpolate({ inputRange: [0, 1], outputRange: [4, 16] }),
                              borderRadius: 2,
                              backgroundColor: colors.primary,
                            }}
                          />
                        </View>
                        <Text style={{ color: colors.primary, fontFamily: 'NotoSansBengali', fontSize: ui.font.sm }}>
                          {t('editor.playingTimer', {
                            elapsed: formatDurationMillis(playbackPositionMillis),
                            total: playbackDurationMillis
                              ? formatDurationMillis(playbackDurationMillis)
                              : '--:--',
                          })}
                        </Text>
                      </View>
                    ) : null}

                    {isAppendRecording ? (
                      <Text style={{ color: colors.error, fontFamily: 'NotoSansBengali', fontSize: ui.font.sm }}>
                        {isRecordingPaused
                          ? t('editor.appendingPaused', { time: formatDuration(recordSeconds) })
                          : t('editor.appending', { time: formatDuration(recordSeconds) })}
                      </Text>
                    ) : null}

                    <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                      <Pressable
                        onPress={() => togglePlayback(group.groupId, group.segments)}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: ui.radius.sm,
                          borderWidth: 1,
                          borderColor: colors.primary,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <MaterialCommunityIcons
                          name={isCurrent ? 'stop' : 'play'}
                          size={18}
                          color={iconOnCard}
                        />
                        <Text style={{ color: iconOnCard, fontFamily: 'NotoSansBengali', fontSize: ui.font.md }}>
                          {isCurrent ? t('editor.audioStop') : t('editor.audioPlay')}
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() =>
                          isAppendRecording
                            ? stopAppendRecording(group.groupId)
                            : startAppendRecording(group.groupId)
                        }
                        disabled={isAnotherRecordingActive}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: ui.radius.sm,
                          borderWidth: 1,
                          borderColor: colors.accent,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          opacity: isAnotherRecordingActive ? 0.5 : 1,
                        }}
                      >
                        <MaterialCommunityIcons
                          name={isAppendRecording ? 'stop' : 'plus-circle-outline'}
                          size={18}
                          color={iconOnCard}
                        />
                        <Text style={{ color: iconOnCard, fontFamily: 'NotoSansBengali', fontSize: ui.font.md }}>
                          {isAppendRecording ? t('editor.appendStop') : t('editor.audioAdd')}
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() => removeAudioGroup(group.groupId)}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: ui.radius.sm,
                          borderWidth: 1,
                          borderColor: colors.error,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <MaterialCommunityIcons name="trash-can-outline" size={18} color={iconOnCard} />
                        <Text style={{ color: iconOnCard, fontFamily: 'NotoSansBengali', fontSize: ui.font.md }}>
                          {t('editor.remove')}
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() => setDetailsTargetGroupId(group.groupId)}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: ui.radius.sm,
                          borderWidth: 1,
                          borderColor: colors.border,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          backgroundColor: colors.background,
                        }}
                      >
                        <MaterialCommunityIcons name="information-outline" size={18} color={iconOnCard} />
                        <Text style={{ color: iconOnCard, fontFamily: 'NotoSansBengali', fontSize: ui.font.md }}>
                          {t('editor.audioDetails')}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>

        {Platform.OS === 'android' ? (
          <Text
            style={{
              marginTop: ui.space.sm,
              color: colors.textSecondary,
              fontFamily: 'NotoSansBengali',
              fontSize: ui.font.xs,
              lineHeight: 18,
            }}
          >
            {t('editor.shareHint')}
          </Text>
        ) : null}
      </ScrollView>

      <View
        style={{
          position: 'absolute',
          left: ui.space.md,
          right: ui.space.md,
          bottom: Math.max(insets.bottom, 10),
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: ui.radius.lg,
          padding: 10,
          gap: 8,
          shadowColor: '#000000',
          shadowOpacity: 0.12,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 7,
        }}
      >
        <PrimaryButton onPress={saveNote} disabled={saveDisabled}>
          {isSaving ? t('editor.saving') : t('editor.save')}
        </PrimaryButton>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            onPress={copyTextContent}
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: colors.primary,
              borderRadius: ui.radius.md,
              minHeight: 42,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.primary,
              paddingHorizontal: 8,
            }}
          >
            <Text style={{ color: actionTextOnPrimary, fontFamily: 'NotoSansBengali', fontSize: ui.font.sm }}>
              {t('editor.copyText')}
            </Text>
          </Pressable>

          <Pressable
            onPress={shareText}
            disabled={!content.trim() && !title.trim()}
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: colors.secondary,
              borderRadius: ui.radius.md,
              minHeight: 42,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: content.trim() || title.trim() ? 1 : 0.5,
              backgroundColor: colors.secondary,
              paddingHorizontal: 8,
            }}
          >
            <Text style={{ color: textOnSecondary, fontFamily: 'NotoSansBengali', fontSize: ui.font.sm }}>
              {t('editor.shareText')}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setIsShareAudioPickerVisible(true)}
            disabled={audios.length === 0}
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: colors.accent,
              borderRadius: ui.radius.md,
              minHeight: 42,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: audios.length > 0 ? 1 : 0.5,
              backgroundColor: colors.accent,
              paddingHorizontal: 8,
            }}
          >
            <Text style={{ color: actionTextOnAccent, fontFamily: 'NotoSansBengali', fontSize: ui.font.sm }}>
              {t('editor.shareAudio')}
            </Text>
          </Pressable>
        </View>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={renameTargetGroupId !== null}
        onRequestClose={() => setRenameTargetGroupId(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.35)',
            justifyContent: 'center',
            padding: 18,
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
                fontFamily: 'NotoSansBengali',
                fontSize: ui.font.lg,
                marginBottom: ui.space.xs,
              }}
            >
              {t('editor.renameTitle')}
            </Text>
            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder={t('editor.renamePlaceholder')}
              placeholderTextColor={colors.textSecondary}
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: ui.radius.sm,
                backgroundColor: colors.background,
                color: colors.text,
                paddingHorizontal: 11,
                paddingVertical: 9,
                fontFamily: 'NotoSansBengali',
                fontSize: ui.font.md,
              }}
            />
            <View style={{ marginTop: ui.space.sm, flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
              <Pressable
                onPress={() => {
                  setRenameTargetGroupId(null);
                  setRenameValue('');
                }}
                style={{ paddingHorizontal: 10, justifyContent: 'center' }}
              >
                <Text style={{ color: colors.textSecondary, fontFamily: 'NotoSansBengali', fontSize: ui.font.md }}>
                  {t('common.cancel')}
                </Text>
              </Pressable>
              <View style={{ width: 120 }}>
                <PrimaryButton onPress={saveAudioRename}>{t('editor.renameSave')}</PrimaryButton>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={isShareAudioPickerVisible}
        onRequestClose={() => setIsShareAudioPickerVisible(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.35)',
            justifyContent: 'center',
            padding: 18,
          }}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: ui.radius.lg,
              borderWidth: 1,
              borderColor: colors.border,
              padding: ui.space.md,
              maxHeight: '70%',
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontFamily: 'NotoSansBengali',
                fontSize: ui.font.lg,
                marginBottom: ui.space.xs,
              }}
            >
              {t('editor.shareAudioPickerTitle')}
            </Text>

            <ScrollView>
              <View style={{ gap: 8 }}>
                {audioGroups.map((group, index) => (
                  <Pressable
                    key={`${group.groupId}-${index}`}
                    onPress={() => group.segments[0] && shareSpecificAudio(group.segments[0])}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: ui.radius.sm,
                      paddingVertical: 9,
                      paddingHorizontal: 11,
                      backgroundColor: colors.background,
                    }}
                  >
                    <Text style={{ color: colors.text, fontFamily: 'NotoSansBengali', fontSize: ui.font.md }}>
                      {`${index + 1}. ${group.displayName}`}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <View style={{ marginTop: 14, alignItems: 'flex-end' }}>
              <Pressable
                onPress={() => setIsShareAudioPickerVisible(false)}
                style={{ paddingHorizontal: 12, paddingVertical: 8 }}
              >
                <Text style={{ color: colors.textSecondary, fontFamily: 'NotoSansBengali', fontSize: ui.font.md }}>
                  {t('editor.close')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={detailsTargetGroupId !== null}
        onRequestClose={() => setDetailsTargetGroupId(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.35)',
            justifyContent: 'center',
            padding: 18,
          }}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: ui.radius.lg,
              borderWidth: 1,
              borderColor: colors.border,
              padding: ui.space.md,
              maxHeight: '72%',
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontFamily: 'NotoSansBengali',
                fontSize: ui.font.lg,
                marginBottom: ui.space.xs,
              }}
            >
              {t('editor.audioLocationTitle')}
            </Text>

            <ScrollView>
              <View style={{ gap: 8 }}>
                {(audioGroups.find((group) => group.groupId === detailsTargetGroupId)?.segments ?? []).map(
                  (segment, index) => (
                    <View
                      key={`${segment.uri}-${index}`}
                      style={{
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: ui.radius.sm,
                        paddingVertical: 9,
                        paddingHorizontal: 11,
                        backgroundColor: colors.background,
                      }}
                    >
                      <Text style={{ color: colors.text, fontFamily: 'NotoSansBengali', fontSize: ui.font.sm }}>
                        {`${index + 1}. ${segment.uri}`}
                      </Text>
                    </View>
                  )
                )}
              </View>
            </ScrollView>

            <View style={{ marginTop: 14, alignItems: 'flex-end' }}>
              <Pressable
                onPress={() => setDetailsTargetGroupId(null)}
                style={{ paddingHorizontal: 12, paddingVertical: 8 }}
              >
                <Text style={{ color: colors.textSecondary, fontFamily: 'NotoSansBengali', fontSize: ui.font.md }}>
                  {t('editor.audioLocationClose')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
};
