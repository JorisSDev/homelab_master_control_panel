import { CalendarDays, HardDrive, LayoutDashboard, MoreHorizontal, Radio, Server, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "./Logo";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "./ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useMediaQuery } from "../lib";
import { RouteLink } from "./Chrome";

const destinations = [
  { href: "/", label: "Overview", icon: LayoutDashboard, mobile: true },
  { href: "/guests", label: "Machines", icon: Server, mobile: true },
  { href: "/reach", label: "Reach", icon: Radio },
  { href: "/storage", label: "Storage", icon: HardDrive },
  { href: "/jobs", label: "Jobs", icon: CalendarDays, mobile: true },
  { href: "/system", label: "System", icon: Settings2 },
] as const;

export function Navigation({ path, go, version, attention }: {
  path: string;
  go: (href: string) => void;
  version: string;
  attention: boolean;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const selectedPage = useRef(false);
  const phone = useMediaQuery("(max-width: 767px)");
  const compact = useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
  const secondaryActive = destinations.some((item) => !("mobile" in item) && current(path, item.href));

  useEffect(() => {
    if (!phone) setMoreOpen(false);
  }, [phone]);

  function link(item: typeof destinations[number], select: (href: string) => void) {
    const Icon = item.icon;
    return (
      <RouteLink href={item.href} go={select} className="nav-link" aria-current={current(path, item.href) ? "page" : undefined} data-sidebar="menu-button">
        <Icon aria-hidden="true" />
        <span className="nav-label">{item.label}</span>
        {item.href === "/" && attention ? <><span className="nav-indicator" aria-hidden="true" /><span className="sr-only">Needs attention</span></> : null}
      </RouteLink>
    );
  }

  return (
    <>
      <aside className="app-sidebar" data-sidebar="sidebar">
        <div data-sidebar="header">
          <RouteLink href="/" go={go} className="brand" aria-label="Home">
            <Logo />
            <span>Master control panel</span>
          </RouteLink>
        </div>
        <nav aria-label="Main navigation" data-sidebar="content">
          <ul data-sidebar="menu">
            {destinations.map((item) => (
              <li key={item.href} data-sidebar="menu-item">
                {compact ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{link(item, go)}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                ) : link(item, go)}
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar-footer" data-sidebar="footer">
          <RouteLink href="/system" go={go} className="version" aria-label={`System, version ${version}`} title={`Version ${version}`}>
            <span className="version-light" aria-hidden="true" />
            <span className="nav-label">{version}</span>
          </RouteLink>
        </div>
      </aside>
      <nav className="phone-nav" aria-label="Phone navigation">
        {destinations.filter((item) => "mobile" in item).map((item) => (
          <div className="phone-nav-item" key={item.href}>{link(item, go)}</div>
        ))}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger asChild>
            <button type="button" className="nav-link" data-active={secondaryActive || undefined}>
              <MoreHorizontal aria-hidden="true" />
              <span className="nav-label">More</span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="navigation-sheet" onCloseAutoFocus={(event) => {
            if (selectedPage.current) event.preventDefault();
            selectedPage.current = false;
          }}>
            <SheetTitle>More pages</SheetTitle>
            <nav aria-label="More pages" className="sheet-navigation">
              {destinations.filter((item) => !("mobile" in item)).map((item) => (
                <div key={item.href}>{link(item, (href) => {
                  selectedPage.current = href !== path;
                  setMoreOpen(false);
                  go(href);
                })}</div>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </nav>
    </>
  );
}

function current(path: string, href: string) {
  return path === href || (href !== "/" && path.startsWith(`${href}/`));
}
