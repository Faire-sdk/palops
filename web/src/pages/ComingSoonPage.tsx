import { Card, EmptyState, PageHeader } from '../components/ui';
import type { IconName } from '../components/icons';

export function ComingSoonPage({ title, icon, description }: { title: string; icon: IconName; description: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <EmptyState icon={icon} title="Coming soon">
          {description}
        </EmptyState>
      </Card>
    </>
  );
}
