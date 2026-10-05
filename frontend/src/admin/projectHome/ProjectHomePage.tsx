import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'

import { ManagementApiError, managementErrorMessage } from '../api'
import ProjectSectionShell from './ProjectSectionShell'
import ProjectDeniedPage from './ProjectDeniedPage'
import {
  getWorkflowSummary,
  type WorkflowStepCode,
  type WorkflowSummary,
} from './api'
import { canViewIndoorSections } from './permissions'

const STEP_CONTENT: Record<
  WorkflowStepCode,
  { label: string; action: string; suffix: string }
> = {
  add_members: {
    label: '加入專案成員',
    action: '前往加入專案成員',
    suffix: '/members',
  },
  add_inspection_items: {
    label: '新增查核項目',
    action: '前往新增查核項目',
    suffix: '/inspection-items',
  },
  create_plan: {
    label: '建立第一個計畫',
    action: '前往建立第一個計畫',
    suffix: '/planning',
  },
  dispatch_draft_tasks: {
    label: '完成草稿任務並派出',
    action: '前往完成草稿任務並派出',
    suffix: '/planning',
  },
  complete_reinspection: {
    label: '追蹤任務進度',
    action: '前往追蹤任務進度',
    suffix: '/progress',
  },
}

export default function ProjectHomePage() {
  const { projectId = '' } = useParams()
  const [result, setResult] = useState<{
    projectId: string
    summary?: WorkflowSummary
    error?: string
    denied?: boolean
  } | null>(null)

  useEffect(() => {
    let active = true
    getWorkflowSummary(projectId)
      .then((nextSummary) => {
        if (active) {
          setResult({ projectId, summary: nextSummary })
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setResult({
            projectId,
            denied:
              caught instanceof ManagementApiError && caught.status === 403,
            error: managementErrorMessage(caught),
          })
        }
      })
    return () => {
      active = false
    }
  }, [projectId])

  const currentResult = result?.projectId === projectId ? result : null
  const summary = currentResult?.summary ?? null
  const error = currentResult?.error ?? ''
  const denied = currentResult?.denied ?? false
  const loading = currentResult === null
  const primary: WorkflowStepCode | null = summary?.primary_step ?? null
  const base = `/admin/projects/${projectId}`

  if (summary && !canViewIndoorSections(summary)) {
    return <Navigate replace to="/field" />
  }

  if (denied) return <ProjectDeniedPage />

  return (
    <ProjectSectionShell
      activeSection="home"
      project={summary?.project ?? null}
      projectId={projectId}
    >
      <section aria-labelledby="project-home-heading">
        <h2 id="project-home-heading">專案首頁</h2>
        {loading && <p>載入中…</p>}
        {error && <p role="alert">{error}</p>}
        {summary && (
          <>
            <section
              aria-labelledby="project-next-step-heading"
              className="project-next-step"
            >
              <h3 id="project-next-step-heading">下一步</h3>
              {primary ? (
                <>
                  <p>{STEP_CONTENT[primary].label}</p>
                  <Link
                    className="button-link"
                    to={`${base}${STEP_CONTENT[primary].suffix}`}
                  >
                    {STEP_CONTENT[primary].action}
                  </Link>
                </>
              ) : (
                <>
                  <p>目前沒有待處理的下一步。</p>
                  <Link className="button-link" to={`${base}/progress`}>
                    追蹤進度
                  </Link>
                </>
              )}
            </section>
            <dl aria-label="專案關鍵數字" className="project-key-numbers">
              <div>
                <dt>成員</dt>
                <dd>{summary.member_count} 人</dd>
              </div>
              <div>
                <dt>查核項目</dt>
                <dd>{summary.inspection_item_count} 項</dd>
              </div>
              {summary.task_counts_visible === false ? (
                <div>
                  <dt>任務數字</dt>
                  <dd>無權查看任務</dd>
                </div>
              ) : (
                <>
                  <div>
                    <dt>草稿任務</dt>
                    <dd>
                      {summary.task_counts.DRAFT} 件
                      <span className="project-key-number-detail">
                        未指派 {summary.draft_tasks_missing_assignee} 件
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>已派出未完成</dt>
                    <dd>
                      {summary.task_counts.PENDING +
                        summary.task_counts.IN_PROGRESS}{' '}
                      件
                    </dd>
                  </div>
                  <div>
                    <dt>待重查</dt>
                    <dd>{summary.pending_reinspection_task_count} 件</dd>
                  </div>
                </>
              )}
            </dl>
          </>
        )}
      </section>
    </ProjectSectionShell>
  )
}
