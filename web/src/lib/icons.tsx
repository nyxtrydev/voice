/* SVG icons ported from the original markup, as React components.
   Each keeps the same viewBox + paths so the existing CSS styles them identically. */

export function BrandIcon() {
  return (
    <svg viewBox="0 0 28 28" fill="none">
      <circle cx="14" cy="14" r="9" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="14" cy="14" r="5" stroke="currentColor" strokeWidth="1.8" />
      <line x1="14" y1="9" x2="14" y2="5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="14" y1="19" x2="14" y2="23" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function DashboardIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <rect x="2" y="2" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="11" y="2" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="2" y="11" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="11" y="11" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function AgentsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 17c0-3.3 3.1-6 7-6s7 2.7 7 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

//comment env update

export function BookingsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 8h14" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 2v4M13 2v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function CallsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <path
        d="M17.9 14.4v2.4a1.6 1.6 0 0 1-1.7 1.6 15.9 15.9 0 0 1-6.9-2.4 15.6 15.6 0 0 1-4.8-4.8 15.9 15.9 0 0 1-2.4-7A1.6 1.6 0 0 1 3.7 2.1h2.4a1.6 1.6 0 0 1 1.6 1.4c.1.8.3 1.6.6 2.3a1.6 1.6 0 0 1-.4 1.7l-1 1a12.8 12.8 0 0 0 4.8 4.8l1-1a1.6 1.6 0 0 1 1.7-.4c.7.3 1.5.5 2.3.6a1.6 1.6 0 0 1 1.4 1.6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PromptsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <path d="M5 7h10M5 10h7M5 13h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function LogoutIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <path
        d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M10 11l3-3-3-3M13 8H6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PersonSelectIcon() {
  return (
    <svg className="select-icon" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="6.5" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 14c0-2.8 2.5-5 5.5-5s5.5 2.2 5.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function Chevron() {
  return (
    <svg className="select-chevron" viewBox="0 0 12 12" fill="none">
      <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <path d="M4 4a8 8 0 0 1 13.3 2M3 10a7 7 0 0 0 12.3 4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M17 2v4h-4M3 14v-4H7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function PlayTriangle() {
  return (
    <svg viewBox="0 0 14 14" fill="none">
      <path d="M3 2l9 5-9 5V2Z" fill="currentColor" />
    </svg>
  );
}

export function ResumeTriangle() {
  return (
    <svg viewBox="0 0 14 14" fill="none">
      <path d="M4 2.5l7 4.5-7 4.5V2.5Z" fill="currentColor" />
    </svg>
  );
}

export function StopSquare() {
  return (
    <svg viewBox="0 0 14 14" fill="none">
      <rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function ArrowRight() {
  return (
    <svg viewBox="0 0 12 12" fill="none">
      <path d="M4.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BackChevron() {
  return (
    <svg viewBox="0 0 12 12" fill="none">
      <path d="M7.5 3L4.5 6l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function SaveCheck() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <path d="M13 5L6.5 11.5 3 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PersonEmptyIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="20" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M8 44c0-8.8 7.2-16 16-16s16 7.2 16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function TargetEmptyIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="18" stroke="currentColor" strokeWidth="2" />
      <circle cx="24" cy="24" r="10" stroke="currentColor" strokeWidth="2" />
      <line x1="24" y1="14" x2="24" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function MetricCallsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <path
        d="M17.9 14.4v2.4a1.6 1.6 0 0 1-1.7 1.6 15.9 15.9 0 0 1-6.9-2.4 15.6 15.6 0 0 1-4.8-4.8 15.9 15.9 0 0 1-2.4-7A1.6 1.6 0 0 1 3.7 2.1h2.4a1.6 1.6 0 0 1 1.6 1.4c.1.8.3 1.6.6 2.3a1.6 1.6 0 0 1-.4 1.7l-1 1a12.8 12.8 0 0 0 4.8 4.8l1-1a1.6 1.6 0 0 1 1.7-.4c.7.3 1.5.5 2.3.6a1.6 1.6 0 0 1 1.4 1.6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MetricBookingsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 8h14" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 2v4M13 2v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function MetricClockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 6.5V10l2.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MetricStarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <path d="M10 2l2.1 5.9H18l-4.9 3.6 1.9 5.9L10 14l-5 3.4 1.9-5.9L2 8l5.9-.1z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function TemplateClinicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M22 16.9v3a2 2 0 0 1-2.2 2 19.7 19.7 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.7 19.7 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7A2 2 0 0 1 22 16.9Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TemplateAutoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="18" cy="17" r="3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="7" cy="17" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function TemplateTechIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
