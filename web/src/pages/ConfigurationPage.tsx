import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import SearchIcon from '@mui/icons-material/Search';
import TuneIcon from '@mui/icons-material/Tune';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import { useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { EmptyState, ErrorState, KeyValue, Loading, Mono, PageHeader, Section } from '../components/common';
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
  if (typeof value === 'boolean') return value ? <Chip label="On" color="success" variant="outlined" /> : <Chip label="Off" variant="outlined" />;
  if (value === '') return <Mono muted>not set</Mono>;
  return <Mono>{String(value)}</Mono>;
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
    body = offline ? (
      <Section>
        <EmptyState icon={DnsOutlinedIcon} title="Server unavailable">
          {error.message}
        </EmptyState>
      </Section>
    ) : (
      <ErrorState error={error} onRetry={reload} />
    );
  } else if (groups.length === 0) {
    body = (
      <Section>
        <EmptyState icon={TuneIcon} title="No matching settings" />
      </Section>
    );
  } else {
    body = (
      <Grid container spacing={2}>
        {groups.map((g) => (
          <Grid key={g.title} size={{ xs: 12, lg: 6 }}>
            <Section title={g.title}>
              <KeyValue items={g.keys.map((k) => [k, <Value value={data!.settings[k] ?? ''} />] as [string, ReactNode])} />
            </Section>
          </Grid>
        ))}
      </Grid>
    );
  }

  return (
    <>
      <PageHeader
        title="Configuration"
        description="The settings the server is running with, read live from the REST API."
        actions={
          <TextField
            placeholder="Search settings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ width: { xs: '100%', sm: 260 } }}
            slotProps={{
              htmlInput: { 'aria-label': 'Search settings' },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
        }
      />
      <Alert severity="info" sx={{ mb: 2 }}>
        Read-only for now. The REST API can’t change settings; editing PalWorldSettings.ini needs PalOps on the game machine, which is planned.
      </Alert>
      {body}
    </>
  );
}
