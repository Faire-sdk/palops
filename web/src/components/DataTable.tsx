import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { visuallyHidden } from './common';

export interface Column<T> {
  key: string;
  /** Empty for a column of buttons; screen readers then hear "Actions". */
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
  label = 'Table',
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  empty?: ReactNode;
  /** Makes whole rows clickable; links and buttons inside a row still do their own thing. */
  onRowClick?: (row: T) => void;
  /** Names the table when it scrolls sideways and becomes a keyboard stop. */
  label?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const scrolls = useScrollsSideways(container, rows.length);

  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    // A table wider than the screen takes focus, so the keyboard can scroll it.
    // Positioned, so the hidden "Actions" label stays inside the scrolling box instead of widening the page.
    <TableContainer ref={container} sx={{ position: 'relative' }} {...(scrolls ? { tabIndex: 0, role: 'region', 'aria-label': `${label}, scrolls sideways` } : {})}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {columns.map((c) => (
              <TableCell key={c.key} align={c.align}>
                {c.header || <Box component="span" sx={visuallyHidden}>Actions</Box>}
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

/** Whether the element is wider than the space it has, rechecked when it resizes. */
function useScrollsSideways(ref: RefObject<HTMLElement | null>, rowCount: number) {
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rowCount]);
  return scrolls;
}
