import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import type { MouseEvent, ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /** Keep the cell on one line. */
  nowrap?: boolean;
}

/** A Material table driven by column definitions; scrolls sideways on small screens. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  empty?: ReactNode;
  /** Makes whole rows clickable; links and buttons inside a row still do their own thing. */
  onRowClick?: (row: T) => void;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            {columns.map((c) => (
              <TableCell key={c.key} align={c.align}>
                {c.header}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={rowKey(row)}
              hover
              onClick={onRowClick && ((e: MouseEvent) => !(e.target as HTMLElement).closest('a, button') && onRowClick(row))}
              sx={onRowClick ? { cursor: 'pointer' } : undefined}
            >
              {columns.map((c) => (
                <TableCell key={c.key} align={c.align} sx={c.nowrap ? { whiteSpace: 'nowrap' } : undefined}>
                  {c.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
