export function StatusBar() {
  return (
    <footer className="statusbar" data-testid="statusbar" role="status">
      <span>
        <span className="statusbar__dot" aria-hidden="true" />
        Ready
      </span>
      <span className="statusbar__spacer" />
      <span data-testid="statusbar-zoom">100%</span>
    </footer>
  );
}
