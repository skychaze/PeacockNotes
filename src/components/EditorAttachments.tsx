import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Alert, Image, SectionList, View } from 'react-native';
import type { SectionListRenderItemInfo, StyleProp, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { AnimatedBars } from './AnimatedBars';
import { AppText } from './AppText';
import { IconButton } from './IconButton';
import { PressableScale } from './PressableScale';
import { ProgressFill } from './ProgressFill';
import { useEntrance } from './entrance';
import { useLanguage } from '../i18n/LanguageContext';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { NoteAudioDraft, NoteFileDraft } from '../types/models';
import { getFileIcon, isImageFile } from '../utils/fileFormat';

export type AudioGroup = {
  groupId: string;
  displayName: string;
  segments: NoteAudioDraft[];
};

export type AudioAttachmentHandle = {
  stopPlayback: () => Promise<void>;
  toggleGroupPlayback: (groupId: string) => Promise<void>;
};

type EditorAttachmentsProps = {
  audioGroups: AudioGroup[];
  files: NoteFileDraft[];
  recordingActive: boolean;
  recordingGroupId: string | null;
  recordingPaused: boolean;
  onOpenGroupActions: (groupId: string) => void;
  onOpenFile: (file: NoteFileDraft) => void;
  onOpenFileActions: (file: NoteFileDraft) => void;
  header: ReactElement;
  footer: ReactElement;
  contentContainerStyle: StyleProp<ViewStyle>;
};

type PlaybackQueue = {
  segments: NoteAudioDraft[];
  nextIndex: number;
  startedAtMillis: number;
};

type AudioGroupRowProps = {
  group: AudioGroup;
  isCurrent: boolean;
  progress: number;
  playbackPositionMillis: number;
  playbackDurationMillis: number;
  recordingActive: boolean;
  recordingGroupId: string | null;
  recordingPaused: boolean;
  recordingSeconds: number;
  index: number;
  onTogglePlayback: (groupId: string, segments: NoteAudioDraft[]) => void | Promise<void>;
  onOpenActions: (groupId: string) => void;
};

type FileRowProps = {
  file: NoteFileDraft;
  index: number;
  onOpen: (file: NoteFileDraft) => void;
  onOpenActions: (file: NoteFileDraft) => void;
};

type AudioRow = {
  kind: 'audio';
  group: AudioGroup;
};

type FileRow = {
  kind: 'file';
  file: NoteFileDraft;
};

type AttachmentRow = AudioRow | FileRow;

type AttachmentSection = {
  key: 'audio' | 'files';
  title: string;
  data: AttachmentRow[];
};

const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60).toString().padStart(2, '0');
  const remainingSeconds = (safeSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
};

const formatDurationMillis = (millis: number) => formatDuration(Math.floor(Math.max(0, millis) / 1000));

const useRecordingSeconds = (recordingActive: boolean, recordingPaused: boolean) => {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!recordingActive || recordingPaused) {
      return;
    }

    const timer = setInterval(() => {
      setSeconds((previous) => previous + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [recordingActive, recordingPaused]);

  useEffect(() => {
    if (!recordingActive) {
      setSeconds(0);
    }
  }, [recordingActive]);

  return seconds;
};

const AudioGroupRow = ({
  group,
  isCurrent,
  progress,
  playbackPositionMillis,
  playbackDurationMillis,
  recordingActive,
  recordingGroupId,
  recordingPaused,
  recordingSeconds,
  index,
  onTogglePlayback,
  onOpenActions,
}: AudioGroupRowProps) => {
  const { colors } = useAppColors();
  const { t } = useLanguage();
  const entrance = useEntrance();
  const isAppendRecording = recordingActive && recordingGroupId === group.groupId;

  return (
    <Animated.View
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
          onPress={() => onTogglePlayback(group.groupId, group.segments)}
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
          onPress={() => onOpenActions(group.groupId)}
          accessibilityLabel={t('editor.audioDetails')}
        />
      </View>

      {isCurrent ? (
        <ProgressFill
          progress={progress}
          trackColor={colors.surfaceVariant}
          fillColor={colors.primary}
        />
      ) : null}

      {isAppendRecording && recordingPaused ? (
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
          {recordingPaused
            ? t('editor.appendingPaused', { time: formatDuration(recordingSeconds) })
            : t('editor.appending', { time: formatDuration(recordingSeconds) })}
        </AppText>
      ) : null}
    </Animated.View>
  );
};

const MemoAudioGroupRow = memo(AudioGroupRow);

const FileRow = ({ file, index, onOpen, onOpenActions }: FileRowProps) => {
  const { colors } = useAppColors();
  const entrance = useEntrance();
  const iconName = getFileIcon(file.mimeType) as keyof typeof MaterialCommunityIcons.glyphMap;
  const isImage = isImageFile(file.mimeType, file.displayName, file.uri);

  return (
    <Animated.View
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
        onPress={() => onOpen(file)}
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
        <AppText variant="bodySmall" numberOfLines={2} style={{ flex: 1 }}>
          {file.displayName}
        </AppText>
      </PressableScale>
      <IconButton icon="dots-vertical" size={20} onPress={() => onOpenActions(file)} />
    </Animated.View>
  );
};

const MemoFileRow = memo(FileRow);

export const EditorAttachments = forwardRef<AudioAttachmentHandle, EditorAttachmentsProps>(function EditorAttachments({
  audioGroups,
  files,
  recordingActive,
  recordingGroupId,
  recordingPaused,
  onOpenGroupActions,
  onOpenFile,
  onOpenFileActions,
  header,
  footer,
  contentContainerStyle,
}, ref) {
  const { t } = useLanguage();
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingGroupId, setPlayingGroupId] = useState<string | null>(null);
  const [playbackPositionMillis, setPlaybackPositionMillis] = useState(0);
  const [playbackDurationMillis, setPlaybackDurationMillis] = useState(0);
  const recordingSeconds = useRecordingSeconds(
    recordingActive && recordingGroupId !== null,
    recordingPaused
  );
  const soundRef = useRef<Audio.Sound | null>(null);
  const playbackQueueRef = useRef<PlaybackQueue | null>(null);
  const isPlaybackStoppingRef = useRef(false);

  const stopCurrentPlayback = useCallback(async () => {
    isPlaybackStoppingRef.current = true;
    try {
      const currentSound = soundRef.current;
      if (currentSound) {
        await currentSound.stopAsync();
        await currentSound.unloadAsync();
      }
    } catch {
    } finally {
      soundRef.current = null;
      playbackQueueRef.current = null;
      setIsPlaying(false);
      setPlayingGroupId(null);
      setPlaybackPositionMillis(0);
      setPlaybackDurationMillis(0);
      isPlaybackStoppingRef.current = false;
    }
  }, []);

  const playSegmentQueue = useCallback(async (groupId: string): Promise<void> => {
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
      if (!status.isLoaded || playbackQueueRef.current !== queue) {
        return;
      }

      const elapsed = queue.startedAtMillis + status.positionMillis;
      const duration = queue.startedAtMillis + (status.durationMillis ?? 0);
      setPlaybackPositionMillis(elapsed);
      setPlaybackDurationMillis(duration);

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
  }, [stopCurrentPlayback, t]);

  const togglePlayback = useCallback(async (groupId: string, segments: NoteAudioDraft[]) => {
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

      playbackQueueRef.current = { segments, nextIndex: 0, startedAtMillis: 0 };
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
  }, [isPlaying, playSegmentQueue, playingGroupId, stopCurrentPlayback, t]);

  const toggleGroupPlayback = useCallback(async (groupId: string) => {
    const group = audioGroups.find((item) => item.groupId === groupId);
    if (!group || group.segments.length === 0) {
      return;
    }
    await togglePlayback(groupId, group.segments);
  }, [audioGroups, togglePlayback]);

  useImperativeHandle(
    ref,
    () => ({ stopPlayback: stopCurrentPlayback, toggleGroupPlayback }),
    [stopCurrentPlayback, toggleGroupPlayback],
  );

  useEffect(() => {
    if (playingGroupId && !audioGroups.some((group) => group.groupId === playingGroupId)) {
      void stopCurrentPlayback();
    }
  }, [audioGroups, playingGroupId, stopCurrentPlayback]);

  useEffect(() => {
    return () => {
      void stopCurrentPlayback();
    };
  }, [stopCurrentPlayback]);

  const sections = useMemo<AttachmentSection[]>(
    () => [
      {
        key: 'audio',
        title: t('editor.audioSection'),
        data: audioGroups.map<AudioRow>((group) => ({ kind: 'audio', group })),
      },
      {
        key: 'files',
        title: t('editor.fileSection'),
        data: files.map<FileRow>((file) => ({ kind: 'file', file })),
      },
    ],
    [audioGroups, files, t]
  );

  const renderItem = useCallback((info: SectionListRenderItemInfo<AttachmentRow, AttachmentSection>) => {
    const { item, index } = info;
    if (item.kind === 'audio') {
      const isCurrent = isPlaying && playingGroupId === item.group.groupId;
      const progress = isCurrent && playbackDurationMillis > 0
        ? Math.min(1, Math.max(0, playbackPositionMillis / playbackDurationMillis))
        : 0;
      return (
        <MemoAudioGroupRow
          group={item.group}
          isCurrent={isCurrent}
          progress={progress}
          playbackPositionMillis={isCurrent ? playbackPositionMillis : 0}
          playbackDurationMillis={isCurrent ? playbackDurationMillis : 0}
          recordingActive={recordingActive}
          recordingGroupId={recordingGroupId}
          recordingPaused={recordingPaused}
          recordingSeconds={recordingGroupId === item.group.groupId ? recordingSeconds : 0}
          index={index}
          onTogglePlayback={togglePlayback}
          onOpenActions={onOpenGroupActions}
        />
      );
    }

    return (
      <MemoFileRow
        file={item.file}
        index={index}
        onOpen={onOpenFile}
        onOpenActions={onOpenFileActions}
      />
    );
  }, [
    isPlaying,
    onOpenFile,
    onOpenFileActions,
    onOpenGroupActions,
    playbackDurationMillis,
    playbackPositionMillis,
    playingGroupId,
    recordingActive,
    recordingGroupId,
    recordingPaused,
    recordingSeconds,
    togglePlayback,
  ]);

  const renderSectionHeader = useCallback(({ section }: { section: AttachmentSection }) => (
    <AppText variant="headline" style={{ marginTop: ui.space.lg, marginBottom: ui.space.sm }}>
      {section.title}
    </AppText>
  ), []);

  return (
    <SectionList<AttachmentRow, AttachmentSection>
      sections={sections}
      keyExtractor={(item) => item.kind === 'audio'
        ? `audio:${item.group.groupId}`
        : `file:${item.file.portableId ?? item.file.uri}`}
      renderItem={renderItem}
      renderSectionHeader={renderSectionHeader}
      ItemSeparatorComponent={() => <View style={{ height: ui.space.sm }} />}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      contentContainerStyle={contentContainerStyle}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      updateCellsBatchingPeriod={50}
      windowSize={7}
      removeClippedSubviews
      stickySectionHeadersEnabled={false}
    />
  );
});
