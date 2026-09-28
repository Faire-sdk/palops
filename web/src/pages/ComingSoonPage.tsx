import { EmptyState, PageHeader, Section, type IconComponent } from '../components/common';

export function ComingSoonPage({ title, icon, description }: { title: string; icon: IconComponent; description: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Section>
        <EmptyState icon={icon} title="Coming soon">
          {description}
        </EmptyState>
      </Section>
    </>
  );
}
