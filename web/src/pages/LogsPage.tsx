import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Pagination from '@mui/material/Pagination';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useState } from 'react';
import type { AuditEntry } from '../api/types';
import { EmptyState, ErrorState, Loading, Mono, PageHeader, Section } from '../components/common';
import { DataTable } from '../components/DataTable';
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
      <Section
        title="Audit log"
        disablePadding
        action={
          <TextField
            select
            label="Category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(0);
            }}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">All categories</MenuItem>
            {CATEGORIES.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
        }
      >
        {loading && !data ? (
          <Loading />
        ) : error && !data ? (
          <ErrorState error={error} onRetry={reload} />
        ) : (
          <>
            <DataTable
              rows={data?.entries ?? []}
              rowKey={(e) => e.id}
              empty={<EmptyState title="No log entries yet" />}
              columns={[
                { key: 'time', header: 'Time', nowrap: true, render: (e) => formatDateTime(e.createdAt) },
                { key: 'actor', header: 'User', render: (e) => e.actorUsername ?? '—' },
                { key: 'category', header: 'Category', render: (e) => <Chip label={e.category} variant="outlined" /> },
                { key: 'action', header: 'Action', render: (e) => e.action.replace(/_/g, ' ') },
                { key: 'target', header: 'Target', render: (e) => e.target ?? '' },
                { key: 'details', header: 'Details', render: (e) => (e.details ? <Mono muted>{JSON.stringify(e.details)}</Mono> : '') },
                { key: 'ip', header: 'IP', render: (e) => <Mono muted>{e.ip}</Mono> },
              ]}
            />
            {data && data.total > PAGE_SIZE && (
              <Stack sx={{ alignItems: 'center', py: 2 }}>
                <Pagination count={pages} page={page + 1} onChange={(_, p) => setPage(p - 1)} color="primary" />
              </Stack>
            )}
          </>
        )}
      </Section>
    </>
  );
}
