import { useState } from 'react';
import type { AuditEntry } from '../api/types';
import { Table } from '../components/Table';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, PageHeader, Select } from '../components/ui';
import { formatDateTime } from '../format';
import { useApi } from '../hooks/useApi';

const CATEGORIES = ['auth', 'users', 'server', 'players', 'console', 'config', 'backups'];
const PAGE_SIZE = 25;

export function LogsPage() {
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);
  const path = `/logs/audit?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}${category ? `&category=${category}` : ''}`;
  const { data, error, loading, reload } = useApi<{ entries: AuditEntry[]; total: number }>(path);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader title="Logs" description="Audit history of sign-ins and administrative actions." />
      <Card
        title="Audit log"
        actions={
          <Select
            aria-label="Category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        }
      >
        {loading && !data ? (
          <Loading />
        ) : error && !data ? (
          <ErrorState error={error} onRetry={reload} />
        ) : (
          <>
            <Table
              rows={data?.entries ?? []}
              rowKey={(e) => e.id}
              empty={<EmptyState title="No log entries yet" />}
              columns={[
                { key: 'time', header: 'Time', render: (e) => <span className="nowrap">{formatDateTime(e.createdAt)}</span> },
                { key: 'actor', header: 'User', render: (e) => e.actorUsername ?? <span className="muted">—</span> },
                { key: 'category', header: 'Category', render: (e) => <Badge>{e.category}</Badge> },
                { key: 'action', header: 'Action', render: (e) => e.action.replace(/_/g, ' ') },
                { key: 'target', header: 'Target', render: (e) => e.target ?? '' },
                {
                  key: 'details',
                  header: 'Details',
                  render: (e) => (e.details ? <code className="details">{JSON.stringify(e.details)}</code> : ''),
                },
                { key: 'ip', header: 'IP', render: (e) => <span className="mono muted">{e.ip}</span> },
              ]}
            />
            {data && data.total > PAGE_SIZE && (
              <div className="pager">
                <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <span className="muted">
                  Page {page + 1} of {pages}
                </span>
                <Button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
