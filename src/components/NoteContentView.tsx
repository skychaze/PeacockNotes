import { useMemo } from 'react';
import { Text } from 'react-native';
import { AppText, getFontFamily } from './AppText';
import { useLanguage } from '../i18n/LanguageContext';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { AttachmentCatalog, AudioGroupAttachment } from '../utils/attachmentReferences';
import { parseAttachmentText, resolveAttachment } from '../utils/attachmentReferences';
import type { NoteFileDraft } from '../types/models';

type NoteContentViewProps = {
  content: string;
  audioGroups: readonly AudioGroupAttachment[];
  files: readonly NoteFileDraft[];
  onPressAudio: (groupId: string) => void;
  onPressFile: (file: NoteFileDraft) => void;
};

/**
 * Read-only note content. Tagged attachments render inline as tappable tags;
 * references whose attachment is gone fall back to their stored name.
 */
export const NoteContentView = ({
  content,
  audioGroups,
  files,
  onPressAudio,
  onPressFile,
}: NoteContentViewProps) => {
  const { colors, isDark } = useAppColors();
  const { t, language } = useLanguage();
  const catalog = useMemo<AttachmentCatalog>(() => ({ audioGroups, files }), [audioGroups, files]);
  const parts = useMemo(() => parseAttachmentText(content), [content]);

  if (!content.trim()) {
    return (
      <AppText variant="body" color={colors.textSecondary} style={{ paddingTop: ui.space.sm }}>
        {t('common.noText')}
      </AppText>
    );
  }

  const tagBackground = isDark ? 'rgba(79,209,165,0.18)' : 'rgba(10,125,98,0.10)';

  return (
    <Text
      style={{
        color: colors.text,
        fontFamily: getFontFamily(language, '400'),
        fontWeight: language === 'bn' ? undefined : '400',
        fontSize: ui.type.headline.size,
        lineHeight: 26,
        paddingTop: ui.space.sm,
      }}
    >
      {parts.map((part, index) => {
        const tag = part.reference ? resolveAttachment(part.reference, catalog) : undefined;
        if (!tag) {
          return <Text key={index}>{part.text}</Text>;
        }

        return (
          <Text
            key={index}
            suppressHighlighting
            accessibilityRole="link"
            accessibilityLabel={tag.displayName}
            onPress={() => {
              if (tag.kind === 'audio') {
                onPressAudio(tag.groupId);
                return;
              }
              onPressFile(tag.file);
            }}
            style={{
              color: colors.primary,
              backgroundColor: tagBackground,
              fontFamily: getFontFamily(language, '600'),
              fontWeight: language === 'bn' ? undefined : '600',
            }}
          >
            {`@${tag.displayName}`}
          </Text>
        );
      })}
    </Text>
  );
};
