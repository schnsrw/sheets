import type { CSSProperties } from 'react';
import * as SvgIcons from './svg-icons';
import * as SvgIconsExtra from './svg-icons-extra';

/**
 * Material Symbols Outlined icon. Names are from
 * https://fonts.google.com/icons (e.g. "format_bold").
 *
 * Rendering strategy:
 *
 *   1. If the name has an entry in `NAME_TO_SVG`, render that inline
 *      SVG component (lifted verbatim from docx-editor — viewBox
 *      `0 -960 960 960`, Material Symbols path data). Sharp at every
 *      size, no font-load delay, no FOUT.
 *   2. Otherwise fall back to the Material Symbols font ligature so
 *      every name in our codebase still renders something. As
 *      additional names get inline SVGs added to svg-icons.tsx, they
 *      auto-promote the next time `NAME_TO_SVG` is updated.
 *
 * For icon-only buttons, the parent `<button>` carries the `aria-label`
 * — the icon itself is decorative (`aria-hidden`).
 */

type Props = {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  filled?: boolean;
  className?: string;
  style?: CSSProperties;
};

type SvgComp = (p: { size?: number; className?: string; style?: CSSProperties }) => JSX.Element;

const SIZE_PX: Record<NonNullable<Props['size']>, number> = {
  sm: 16,
  md: 20,
  lg: 24,
};

/**
 * Material-Symbols-name → inline-SVG component. Keep names sorted; the
 * left-hand keys ARE the names we use across the app (see
 * tests/e2e and grep of `name="…"`/`icon="…"`). The right side is the
 * matching docx-editor component from svg-icons.tsx.
 *
 * If a name isn't here yet, the font fallback renders. Add an entry
 * when you want the SVG-quality bump for that name.
 */
const NAME_TO_SVG: Record<string, SvgComp> = {
  add: SvgIcons.IconAdd,
  add_comment: SvgIcons.IconAddComment,
  arrow_drop_down: SvgIcons.IconDropdown,
  border_all: SvgIcons.IconBorderAll,
  border_bottom: SvgIcons.IconBorderBottom,
  border_clear: SvgIcons.IconBorderClear,
  border_color: SvgIcons.IconBorderColor,
  border_inner: SvgIcons.IconBorderInner,
  border_left: SvgIcons.IconBorderLeft,
  border_outer: SvgIcons.IconBorderOuter,
  border_right: SvgIcons.IconBorderRight,
  border_top: SvgIcons.IconBorderTop,
  bug_report: SvgIcons.IconBugReport,
  check: SvgIcons.IconCheck,
  check_circle: SvgIcons.IconCheckCircle,
  close: SvgIcons.IconClose,
  comment: SvgIcons.IconComment,
  content_copy: SvgIcons.IconContentCopy,
  content_cut: SvgIcons.IconContentCut,
  content_paste: SvgIcons.IconContentPaste,
  content_paste_go: SvgIcons.IconContentPasteGo,
  delete: SvgIcons.IconDelete,
  delete_sweep: SvgIcons.IconDeleteSweep,
  done_all: SvgIcons.IconDoneAll,
  drag_indicator: SvgIcons.IconDragIndicator,
  edit: SvgIcons.IconEditNote,
  edit_note: SvgIcons.IconEditNote,
  expand_less: SvgIcons.IconExpandLess,
  expand_more: SvgIcons.IconExpandMore,
  file_download: SvgIcons.IconFileDownload,
  file_upload: SvgIcons.IconFileUpload,
  find_replace: SvgIcons.IconFindReplace,
  fit_width: SvgIcons.IconFitWidth,
  flip_to_back: SvgIcons.IconFlipToBack,
  flip_to_front: SvgIcons.IconFlipToFront,
  format_align_center: SvgIcons.IconAlignCenter,
  format_align_justify: SvgIcons.IconAlignJustify,
  format_align_left: SvgIcons.IconAlignLeft,
  format_align_right: SvgIcons.IconAlignRight,
  format_bold: SvgIcons.IconBold,
  format_clear: SvgIcons.IconFormatClear,
  // `format_color_fill` used to map to the paint-bucket-with-drip icon
  // (Material's literal `format_color_fill`). The highlighter-pen
  // variant reads better against text — it's the icon Google Docs /
  // Notion use for the same action and looks less like "spill a
  // bucket" and more like "highlight some text".
  format_color_fill: SvgIcons.IconHighlight,
  // `format_color_text` used to render Material's "A with bar" which
  // is visually heavy at toolbar size. The pencil-with-colour-bar
  // (`border_color` glyph in MS terms) is the same affordance shape
  // — a writing tool with a colour indicator — but much lighter and
  // sits comfortably next to its fill-color sibling.
  format_color_text: SvgIcons.IconBorderColor,
  format_indent_decrease: SvgIcons.IconIndentDecrease,
  format_indent_increase: SvgIcons.IconIndentIncrease,
  format_italic: SvgIcons.IconItalic,
  format_line_spacing: SvgIcons.IconLineSpacing,
  format_list_bulleted: SvgIcons.IconListBulleted,
  format_list_numbered: SvgIcons.IconListNumbered,
  format_paint: SvgIcons.IconFormatPaint,
  format_shapes: SvgIcons.IconShapes,
  format_strikethrough: SvgIcons.IconStrikethrough,
  format_textdirection_l_to_r: SvgIcons.IconTextDirectionLtr,
  format_textdirection_r_to_l: SvgIcons.IconTextDirectionRtl,
  format_underlined: SvgIcons.IconUnderline,
  grid_on: SvgIcons.IconGridOn,
  height: SvgIcons.IconHeight,
  horizontal_rule: SvgIcons.IconHorizontalRule,
  image: SvgIcons.IconImage,
  info: SvgIcons.IconInfo,
  keyboard_arrow_down: SvgIcons.IconKeyboardArrowDown,
  keyboard_arrow_left: SvgIcons.IconKeyboardArrowLeft,
  keyboard_arrow_right: SvgIcons.IconKeyboardArrowRight,
  keyboard_arrow_up: SvgIcons.IconKeyboardArrowUp,
  line_weight: SvgIcons.IconLineWeight,
  link: SvgIcons.IconLink,
  more_vert: SvgIcons.IconMoreVert,
  note_add: SvgIcons.IconNoteAdd,
  open_with: SvgIcons.IconOpenWith,
  padding: SvgIcons.IconPadding,
  page_break: SvgIcons.IconPageBreak,
  print: SvgIcons.IconPrint,
  rate_review: SvgIcons.IconRateReview,
  redo: SvgIcons.IconRedo,
  remove: SvgIcons.IconRemove,
  rotate_left: SvgIcons.IconRotateLeft,
  rotate_right: SvgIcons.IconRotateRight,
  select_all: SvgIcons.IconSelectAll,
  settings: SvgIcons.IconSettings,
  shapes: SvgIcons.IconShapes,
  spellcheck: SvgIcons.IconSpellcheck,
  subscript: SvgIcons.IconSubscript,
  superscript: SvgIcons.IconSuperscript,
  swap_horiz: SvgIcons.IconSwapHoriz,
  swap_vert: SvgIcons.IconSwapVert,
  table: SvgIcons.IconTable,
  table_chart: SvgIcons.IconTableChart,
  table_rows: SvgIcons.IconTableRows,
  text_rotation_none: SvgIcons.IconTextRotationNone,
  tune: SvgIcons.IconTune,
  undo: SvgIcons.IconUndo,
  vertical_align_bottom: SvgIcons.IconVerticalAlignBottom,
  vertical_align_center: SvgIcons.IconVerticalAlignCenter,
  vertical_align_top: SvgIcons.IconVerticalAlignTop,
  view_column: SvgIcons.IconViewColumn,
  visibility: SvgIcons.IconVisibility,
  wrap_text: SvgIcons.IconWrapText,

  // From svg-icons-extra.tsx — Material Symbols path data for names
  // docx-editor doesn't ship with.
  ac_unit: SvgIconsExtra.IconAcUnit,
  add_box: SvgIconsExtra.IconAddBox,
  align_horizontal_left: SvgIconsExtra.IconAlignHorizontalLeft,
  analytics: SvgIconsExtra.IconAnalytics,
  area_chart: SvgIconsExtra.IconAreaChart,
  arrow_downward: SvgIconsExtra.IconArrowDownward,
  arrow_upward: SvgIconsExtra.IconArrowUpward,
  attach_money: SvgIconsExtra.IconAttachMoney,
  bar_chart: SvgIconsExtra.IconBarChart,
  bookmark_add: SvgIconsExtra.IconBookmarkAdd,
  chevron_left: SvgIconsExtra.IconChevronLeft,
  chevron_right: SvgIconsExtra.IconChevronRight,
  crop_free: SvgIconsExtra.IconCropFree,
  dark_mode: SvgIconsExtra.IconDarkMode,
  description: SvgIconsExtra.IconDescription,
  download: SvgIconsExtra.IconDownload,
  error: SvgIconsExtra.IconError,
  filter_alt: SvgIconsExtra.IconFilterAlt,
  filter_list: SvgIconsExtra.IconFilterList,
  filter_list_off: SvgIconsExtra.IconFilterListOff,
  folder_delete: SvgIconsExtra.IconFolderDelete,
  folder_open: SvgIconsExtra.IconFolderOpen,
  forum: SvgIconsExtra.IconForum,
  functions: SvgIconsExtra.IconFunctions,
  grid_off: SvgIconsExtra.IconGridOff,
  group: SvgIconsExtra.IconGroup,
  group_add: SvgIconsExtra.IconGroupAdd,
  help_outline: SvgIconsExtra.IconHelpOutline,
  history: SvgIconsExtra.IconHistory,
  history_toggle_off: SvgIconsExtra.IconHistoryToggleOff,
  home: SvgIconsExtra.IconHome,
  indeterminate_check_box: SvgIconsExtra.IconIndeterminateCheckBox,
  ios_share: SvgIconsExtra.IconIosShare,
  keyboard_tab: SvgIconsExtra.IconKeyboardTab,
  keyboard_tab_rtl: SvgIconsExtra.IconKeyboardTabRtl,
  last_page: SvgIconsExtra.IconLastPage,
  light_mode: SvgIconsExtra.IconLightMode,
  list: SvgIconsExtra.IconList,
  logout: SvgIconsExtra.IconLogout,
  looks_one: SvgIconsExtra.IconLooksOne,
  menu: SvgIconsExtra.IconMenu,
  navigate_before: SvgIconsExtra.IconNavigateBefore,
  navigate_next: SvgIconsExtra.IconNavigateNext,
  numbers: SvgIconsExtra.IconNumbers,
  open_in_new: SvgIconsExtra.IconOpenInNew,
  palette: SvgIconsExtra.IconPalette,
  percent: SvgIconsExtra.IconPercent,
  pie_chart: SvgIconsExtra.IconPieChart,
  pivot_table_chart: SvgIconsExtra.IconPivotTableChart,
  rule: SvgIconsExtra.IconRule,
  save: SvgIconsExtra.IconSave,
  scatter_plot: SvgIconsExtra.IconScatterPlot,
  schedule: SvgIconsExtra.IconSchedule,
  search: SvgIconsExtra.IconSearch,
  settings_applications: SvgIconsExtra.IconSettingsApplications,
  settings_ethernet: SvgIconsExtra.IconSettingsEthernet,
  share: SvgIconsExtra.IconShare,
  show_chart: SvgIconsExtra.IconShowChart,
  sort: SvgIconsExtra.IconSort,
  splitscreen: SvgIconsExtra.IconSplitscreen,
  table_view: SvgIconsExtra.IconTableView,
  text_decrease: SvgIconsExtra.IconTextDecrease,
  text_fields: SvgIconsExtra.IconTextFields,
  text_increase: SvgIconsExtra.IconTextIncrease,
  today: SvgIconsExtra.IconToday,
  unfold_less: SvgIconsExtra.IconUnfoldLess,
  unfold_more: SvgIconsExtra.IconUnfoldMore,
  unfold_more_double: SvgIconsExtra.IconUnfoldMoreDouble,
  view_stream: SvgIconsExtra.IconViewStream,
  view_week: SvgIconsExtra.IconViewWeek,
  visibility_off: SvgIconsExtra.IconVisibilityOff,
  zoom_in: SvgIconsExtra.IconZoomIn,
  zoom_out: SvgIconsExtra.IconZoomOut,
};

export function Icon({ name, size = 'md', filled, className, style }: Props) {
  const SvgComponent = NAME_TO_SVG[name];
  if (SvgComponent) {
    const px = SIZE_PX[size];
    // The SVG components in svg-icons.tsx use `fill="currentColor"`
    // so they inherit color from the parent (button, link, etc.) —
    // matches the font's behaviour and lets the existing CSS keep
    // colouring via `color:`. `filled` is meaningless for SVGs (the
    // path data is already filled); pass through className/style.
    void filled;
    return (
      <SvgComponent
        size={px}
        className={`icon${className ? ` ${className}` : ''}`}
        style={style}
      />
    );
  }
  // Font fallback — same DOM shape as before so the existing CSS
  // (icon size classes, color inheritance) keeps working.
  const sizeClass = size === 'sm' ? ' icon--sm' : size === 'lg' ? ' icon--lg' : '';
  const filledClass = filled ? ' icon--filled' : '';
  return (
    <span
      className={`icon icon--font${sizeClass}${filledClass}${className ? ` ${className}` : ''}`}
      style={style}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
