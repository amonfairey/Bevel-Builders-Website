/**
 * CoParent Hub shared UI kit. Import from '@/components/ui'.
 * Owned by the foundation: screen owners use these, and put area-specific components in
 * components/<area>/ instead of editing this folder.
 *
 * All components follow the system light/dark setting (lib/theme.ts), use 44 pt touch
 * targets and the iOS type scale, and work in the web preview.
 */

/** Themed text with the iOS type scale: <AppText variant="headline" tone="muted">. */
export { AppText, type AppTextProps, type TextVariant } from './AppText';

/**
 * Screen container: safe areas, ScrollView, pull-to-refresh (refreshing + onRefresh),
 * keyboard avoidance, a pinned `footer`, and either a large in-content `title` (tab roots,
 * no nav bar) or a nav-bar `headerTitle` / `headerRight` (pushed screens).
 */
export { Screen, type ScreenProps } from './Screen';

/** Rounded panel; `tone` adds a colored left border; tappable with onPress. */
export { Card, type CardProps } from './Card';
/** Grouped section with a small uppercase header, optional right `action` and `footer` note. */
export { Section, type SectionProps } from './Card';
/** Tinted notice box (info / warn / bad), like the web portal's alerts. */
export { Callout } from './Card';
/** Hairline separator. */
export { Divider } from './Card';

/**
 * Button: variants primary | default | danger | ok | link, size md | sm, optional Ionicons
 * `icon`, `block` width. If onPress returns a Promise the button shows a spinner until it
 * settles. Light haptic on press (no-op on web).
 */
export { Button, type ButtonProps, type ButtonVariant, type IconName } from './Button';
/** Icon-only 44 pt button (nav bar actions). */
export { IconButton } from './Button';
/** Text button for nav bars (headerLeft / headerRight): Cancel, Save, New. */
export { HeaderButton } from './Button';
/** Wrapping row of buttons. */
export { ButtonRow } from './Button';
/** Trigger the standard light haptic yourself (no-op on web). */
export { tapHaptic } from './Button';

/** Small rounded label with a tone. */
export { Badge } from './Badge';
/** Status label/tone from lib/status.ts (same words as the web portal). */
export { StatusBadge } from './Badge';
/** Red count pill; renders nothing for 0. */
export { CountBadge } from './Badge';
/** Plain colored dot. */
export { Dot } from './Badge';

/** Labelled TextInput with hint and error. */
export { Field, type FieldProps, type TextInputRef } from './Field';
/** Multi-line Field. */
export { TextArea } from './Field';
/** Label/hint/error wrapper for custom controls. */
export { FieldShell } from './Field';
/** Web preview: style that removes the browser's focus ring from a custom TextInput (null on native). */
export { WEB_NO_OUTLINE } from './Field';

/** Tap-to-open option list (bottom sheet modal; works on web). */
export { Select, type SelectProps, type Option, type OptionValue } from './Select';
/** Toggle pills (multi-select by default; multiple={false} for single choice). */
export { Chips, type ChipsProps } from './Select';
/** Labelled Chips (children, weekdays). */
export { MultiSelect } from './Select';
/** iOS-style segmented control. */
export { Segmented } from './Select';

/** Check-circle row with label and hint. */
export { Checkbox, type CheckboxProps } from './Checkbox';
/** Label + Switch. */
export { Toggle } from './Checkbox';

/**
 * Date / time pickers with string values in FAMILY local time: DateField 'YYYY-MM-DD',
 * TimeField 'HH:MM', DateTimeField 'YYYY-MM-DDTHH:MM'. Native pickers on iOS/Android;
 * real <input type="date|time|datetime-local"> on web (DateTimeFields.web.tsx).
 */
export { DateField, TimeField, DateTimeField, type DateTimeFieldProps } from './DateTimeFields';

/** Dot in a family member's color (by user id). */
export { ParentDot } from './Share';
/** Colored bar of each parent's share of time. */
export { ShareBar } from './Share';
/** Share bar + table (time %, overnights, hours) like the web portal's shareView. */
export { ShareTable } from './Share';

/** Icon + title + message (+ action) for empty lists and "coming soon". */
export { EmptyState } from './States';
/** Error message with a Retry button. */
export { ErrorView } from './States';
/** Spinner (optionally full screen). */
export { Loading } from './States';
/** Loading / error / content switch for a useApi() result. */
export { AsyncView } from './States';

/** Grouped-list row: icon or custom left element, subtitle, right text, count badge, chevron. */
export { ListItem, type ListItemProps } from './ListItem';
/** Inset grouped container for ListItems with separators. */
export { ListGroup } from './ListItem';
/** Flex row with gap. */
export { Row } from './ListItem';

/**
 * Modal dialogs (not Alert.alert, which is a no-op on web). Wrap the app in DialogProvider;
 * useDialog() -> { confirm({ title, message, okLabel, cancelLabel, destructive, withNote,
 * noteRequired, notePlaceholder }) => Promise<{ note } | null>, alert(title, message),
 * show({ title, message, content, actions, dismissValue }) => Promise<value> }.
 */
export { DialogProvider, useDialog, type ConfirmOptions, type DialogApi, type ShowOptions } from './Dialog';

/** Bottom toast: useToast().show(msg, { tone }). */
export { ToastProvider, useToast } from './Toast';
/** Run an async action and toast its error / success: await attempt(() => api.post(...), 'Saved'). */
export { useAttempt } from './Toast';

/** Append-only notes list + "add a note" with optional photo, for any record. */
export { NotesPanel } from './NotesPanel';
/** Tone check before sending a message: `if (await toneGate(text)) send()`. */
export { useToneGate } from './ToneGate';

/** Link to a stored file (/api/files/<hash>); images open in an in-app viewer. */
export { AttachmentLink } from './Attachment';
/** "Add photo" / "Take photo" buttons producing an upload payload. */
export { PhotoPicker } from './Attachment';
/** Pick or take a photo -> { name, type, data } for receipts and note attachments. */
export { pickImagePayload } from './Attachment';
