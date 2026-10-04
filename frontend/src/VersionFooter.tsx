export default function VersionFooter() {
  const commit = __INSPECTFLOW_COMMIT__

  return (
    <footer
      className="version-footer"
      title={commit ? `Commit ${commit}` : undefined}
    >
      InspectFlow v{__INSPECTFLOW_VERSION__}
    </footer>
  )
}
