/**
 * Univer plugin CSS — side-effect-only imports for the eager plugin
 * set CasualSheets boots. Hosts import this once at app boot:
 *
 *   import '@schnsrw/casual-sheets/styles';
 *
 * If the host adds lazy plugins (sort, filter, drawing, comments,
 * conditional formatting, …) it imports the corresponding CSS
 * separately — those plugins ship their own /lib/index.css.
 */
import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/docs-ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';
import '@univerjs/sheets-formula-ui/lib/index.css';
import '@univerjs/sheets-numfmt-ui/lib/index.css';
