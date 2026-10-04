export function VersionFooterDisplay({
  version,
  commit,
}: {
  version: string
  commit: string
}) {
  return (
    <footer
      className="version-footer"
      title={commit ? `Commit ${commit}` : undefined}
    >
      InspectFlow v{version}
    </footer>
  )
}

export default function VersionFooter() {
  return (
    <VersionFooterDisplay
      version={__INSPECTFLOW_VERSION__}
      commit={__INSPECTFLOW_COMMIT__}
    />
  )
}
