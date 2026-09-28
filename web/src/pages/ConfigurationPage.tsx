import { useMemo, useState } from 'react';
import { ApiError } from '../api/client';
import { Alert, Badge, Card, EmptyState, ErrorState, Input, Loading, PageHeader } from '../components/ui';
import { useApi } from '../hooks/useApi';

type Settings = Record<string, string | number | boolean>;

/** Groups for the settings the REST API returns; anything unlisted lands in "Other". */
const GROUPS: Array<{ title: string; keys: string[] }> = [
  { title: 'Server', keys: ['ServerName', 'ServerDescription', 'ServerPlayerMaxNum', 'CoopPlayerMaxNum', 'PublicIP', 'PublicPort', 'Region', 'AllowConnectPlatform', 'bUseAuth', 'BanListURL', 'bShowPlayerList', 'bIsMultiplay', 'LogFormatType', 'bIsUseBackupSaveData'] },
  { title: 'Rates', keys: ['Difficulty', 'DayTimeSpeedRate', 'NightTimeSpeedRate', 'ExpRate', 'PalCaptureRate', 'PalSpawnNumRate', 'WorkSpeedRate', 'CollectionDropRate', 'CollectionObjectHpRate', 'CollectionObjectRespawnSpeedRate', 'EnemyDropItemRate', 'PalEggDefaultHatchingTime'] },
  { title: 'Combat and survival', keys: ['DeathPenalty', 'PalDamageRateAttack', 'PalDamageRateDefense', 'PlayerDamageRateAttack', 'PlayerDamageRateDefense', 'PlayerStomachDecreaceRate', 'PlayerStaminaDecreaceRate', 'PlayerAutoHPRegeneRate', 'PlayerAutoHpRegeneRateInSleep', 'PalStomachDecreaceRate', 'PalStaminaDecreaceRate', 'PalAutoHPRegeneRate', 'PalAutoHpRegeneRateInSleep', 'bEnablePlayerToPlayerDamage', 'bEnableFriendlyFire', 'bEnableInvaderEnemy', 'bIsPvP', 'bCanPickupOtherGuildDeathPenaltyDrop', 'bEnableDefenseOtherGuildPlayer', 'bEnableAimAssistPad', 'bEnableAimAssistKeyboard'] },
  { title: 'Guilds and bases', keys: ['GuildPlayerMaxNum', 'BaseCampMaxNum', 'BaseCampWorkerMaxNum', 'BuildObjectDamageRate', 'BuildObjectDeteriorationDamageRate', 'bAutoResetGuildNoOnlinePlayers', 'AutoResetGuildTimeNoOnlinePlayers', 'bEnableNonLoginPenalty', 'bExistPlayerAfterLogout'] },
  { title: 'World', keys: ['DropItemMaxNum', 'DropItemMaxNum_UNKO', 'DropItemAliveMaxHours', 'bActiveUNKO', 'bEnableFastTravel', 'bIsStartLocationSelectByMap'] },
  { title: 'Remote access', keys: ['RESTAPIEnabled', 'RESTAPIPort', 'RCONEnabled', 'RCONPort'] },
];

function Value({ value }: { value: string | number | boolean }) {
  if (typeof value === 'boolean') return value ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>;
  if (value === '') return <span className="muted">not set</span>;
  return <span className="mono">{String(value)}</span>;
}

export function ConfigurationPage() {
  const { data, error, loading, reload } = useApi<{ settings: Settings }>('/config');
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const listed = new Set(GROUPS.flatMap((g) => g.keys));
    const other = Object.keys(data.settings).filter((k) => !listed.has(k)).sort();
    return [...GROUPS, { title: 'Other', keys: other }]
      .map((g) => ({ ...g, keys: g.keys.filter((k) => k in data.settings && (!q || k.toLowerCase().includes(q) || String(data.settings[k] ?? '').toLowerCase().includes(q))) }))
      .filter((g) => g.keys.length > 0);
  }, [data, query]);

  let body;
  if (loading && !data) body = <Loading />;
  else if (error && !data) {
    const offline = error instanceof ApiError && ['palworld_unreachable', 'palworld_not_configured'].includes(error.code);
    body = offline ? <EmptyState icon="server" title="Server unavailable">{error.message}</EmptyState> : <ErrorState error={error} onRetry={reload} />;
  } else if (groups.length === 0) {
    body = <EmptyState icon="config" title="No matching settings" />;
  } else {
    body = groups.map((g) => (
      <Card key={g.title} title={g.title} className="settings-group">
        <dl className="kv">
          {g.keys.map((k) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt className="mono small">{k}</dt>
              <dd>
                <Value value={data!.settings[k] ?? ''} />
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    ));
  }

  return (
    <>
      <PageHeader
        title="Configuration"
        description="The settings the server is running with, read live from the REST API."
        actions={<Input placeholder="Search settings…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search settings" />}
      />
      <Alert tone="info">
        Read-only for now. The REST API can’t change settings; editing PalWorldSettings.ini needs PalOps on the game machine, which is planned.
      </Alert>
      {body}
    </>
  );
}
