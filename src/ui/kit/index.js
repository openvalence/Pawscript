/**
 * index.js -- the kit's public surface. Exports listed here are frozen (add, never rename or remove).
 * See README.md for the API and conventions. Importing this module loads theme.css.
 */
import './theme.css';

export { ICON_NAMES, iconPaths } from './icons.js';
export { tooltip } from './tooltip.js';

// ---- components ----
export { default as Icon } from './Icon.svelte';
// buttons
export { default as Button } from './Button.svelte';
export { default as IconButton } from './IconButton.svelte';
export { default as ToggleButton } from './ToggleButton.svelte';
export { default as SegmentedControl } from './SegmentedControl.svelte';
export { default as Badge } from './Badge.svelte';
export { default as Chip } from './Chip.svelte';
export { default as Kbd } from './Kbd.svelte';
export { default as Spinner } from './Spinner.svelte';
export { default as ProgressBar } from './ProgressBar.svelte';
export { default as Skeleton } from './Skeleton.svelte';
// fields
export { default as Checkbox } from './Checkbox.svelte';
export { default as Switch } from './Switch.svelte';
export { default as RadioGroup } from './RadioGroup.svelte';
export { default as TextField } from './TextField.svelte';
export { default as NumberField } from './NumberField.svelte';
export { default as Slider } from './Slider.svelte';
export { default as RangeSlider } from './RangeSlider.svelte';
export { default as Field } from './Field.svelte';
export { default as ColorSwatch } from './ColorSwatch.svelte';
export { default as ParamForm } from './ParamForm.svelte';
export { default as CurveEditor } from './CurveEditor.svelte';
// menus and lists
export { default as Select } from './Select.svelte';
export { default as ComboBox } from './ComboBox.svelte';
export { default as Menu } from './Menu.svelte';
export { default as ContextMenu } from './ContextMenu.svelte';
export { default as MenuBar } from './MenuBar.svelte';
// overlays
export { default as Popover } from './Popover.svelte';
export { default as Dialog } from './Dialog.svelte';
export { default as ToastHost } from './ToastHost.svelte';
// layout and data
export { default as SplitPane } from './SplitPane.svelte';
export { default as Splitter } from './Splitter.svelte';
export { default as ScrollArea } from './ScrollArea.svelte';
export { default as VirtualList } from './VirtualList.svelte';
export { default as Tree } from './Tree.svelte';
export { default as DataTable } from './DataTable.svelte';
// chrome
export { default as Tabs } from './Tabs.svelte';
export { default as Section } from './Section.svelte';
export { default as PanelHeader } from './PanelHeader.svelte';
export { default as Toolbar } from './Toolbar.svelte';
export { default as StatusBar } from './StatusBar.svelte';
export { default as StatusItem } from './StatusItem.svelte';
export { default as EmptyState } from './EmptyState.svelte';

// ---- imperative helpers ----
export { contextMenu, showContextMenu } from './contextmenu.js';
export { confirm } from './dialog.js';
export { toast, dismissToast, dismissAll, toasts, pauseToasts } from './toast.svelte.js';
export { controlOf } from './paramform.js';

export { THEMES, DENSITIES, SERIES, series, seriesVar, seriesColor, setTheme, setDensity, onThemeChange } from './tokens.js';
export { contrast, cssVar } from './color.js';
export { place, float, dismiss } from './position.js';
export { nextIndex, createTypeahead, trapFocus, tabbables, nextId } from './focus.js';
export { formatShortcut, shortcutText, parseShortcut, isMac } from './keys.js';
export * from './math.js';
export { coerce, defaultsOf, normalizeValues, groupsOf, stepOf, isDefault, choiceList } from './params.js';
