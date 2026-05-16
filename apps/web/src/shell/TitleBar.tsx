type Props = { filename: string };

export function TitleBar({ filename }: Props) {
  return (
    <header className="titlebar" data-testid="titlebar" role="banner">
      <span className="titlebar__brand">
        <span className="titlebar__brand-mark" aria-hidden="true">
          X
        </span>
        <span>Sheet</span>
      </span>
      <span className="titlebar__divider" aria-hidden="true" />
      <span className="titlebar__filename" data-testid="titlebar-filename">
        {filename}
      </span>
      <span className="titlebar__spacer" />
    </header>
  );
}
