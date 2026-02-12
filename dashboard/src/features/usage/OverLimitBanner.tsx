import { useNavigate } from 'react-router';

interface OverLimitBannerProps {
  overLimitResources: string[];
  tier: string;
}

export function OverLimitBanner({ overLimitResources, tier }: OverLimitBannerProps) {
  const navigate = useNavigate();
  if (overLimitResources.length === 0) return null;

  const isPro = tier === 'pro';
  const isHobby = tier === 'hobby';

  let title: string;
  let desc: React.ReactNode;
  let primaryLabel: string;

  if (isPro) {
    title = 'Currently hit the resource limit';
    desc = 'Add resource boosters to keep growing.';
    primaryLabel = 'Add Boosters';
  } else if (isHobby) {
    title = "You're at the Hobby limit";
    desc = (
      <>Upgrade to <b>Pro</b> for higher capacity and room for production workloads.</>
    );
    primaryLabel = 'Upgrade to Pro';
  } else {
    title = "You've hit the Free plan limit";
    desc = (
      <>Upgrade to <b>Hobby</b> for more projects, environments, and API requests.</>
    );
    primaryLabel = 'Upgrade to Hobby';
  }

  return (
    <div className="flex items-center gap-4 rounded-[14px] border border-white/[0.12] bg-[rgba(17,24,39,0.75)] backdrop-blur-sm p-3.5 mb-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground tracking-tight">{title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-text-muted">{desc}</p>
      </div>
      <button
        onClick={() => navigate('/plans')}
        className="shrink-0 inline-flex items-center h-[30px] px-2.5 rounded-[9px] text-xs font-semibold bg-white/[0.92] text-[#0b1020] border border-white/[0.35] hover:-translate-y-px transition-transform cursor-pointer"
      >
        {primaryLabel}
      </button>
    </div>
  );
}
