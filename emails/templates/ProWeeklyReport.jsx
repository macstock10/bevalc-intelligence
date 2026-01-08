import React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

// Brand colors (matches bevalcintel.com)
const colors = {
  primary: "#0d9488",
  primaryDark: "#0f766e",
  primaryLight: "#ccfbf1",
  text: "#1e293b",
  textSecondary: "#475569",
  textTertiary: "#64748b",
  bg: "#ffffff",
  bgSecondary: "#f8fafc",
  bgTertiary: "#f1f5f9",
  border: "#e2e8f0",
  green: "#10b981",
  greenLight: "#d1fae5",
  blue: "#3b82f6",
  blueLight: "#dbeafe",
  purple: "#8b5cf6",
  purpleLight: "#ede9fe",
  orange: "#f97316",
  orangeLight: "#ffedd5",
  red: "#ef4444",
  redLight: "#fee2e2",
  amber: "#f59e0b",
  amberLight: "#fef3c7",
};

// Category colors for badges
const categoryColors = {
  Whiskey: { bg: "#fef3c7", text: "#92400e" },
  Tequila: { bg: "#d1fae5", text: "#065f46" },
  Vodka: { bg: "#dbeafe", text: "#1e40af" },
  Wine: { bg: "#fce7f3", text: "#9d174d" },
  Beer: { bg: "#fed7aa", text: "#9a3412" },
  RTD: { bg: "#e0e7ff", text: "#3730a3" },
  Gin: { bg: "#ccfbf1", text: "#0f766e" },
  Rum: { bg: "#fecaca", text: "#991b1b" },
  Brandy: { bg: "#f5d0fe", text: "#86198f" },
  Liqueur: { bg: "#fef9c3", text: "#854d0e" },
  default: { bg: "#f1f5f9", text: "#475569" },
};

// Signal badge colors
const signalColors = {
  NEW_BRAND: { bg: "#d1fae5", text: "#065f46", label: "New Brand" },
  NEW_SKU: { bg: "#dbeafe", text: "#1e40af", label: "New SKU" },
  NEW_COMPANY: { bg: "#ede9fe", text: "#5b21b6", label: "New Company" },
  REFILE: { bg: "#f1f5f9", text: "#475569", label: "Refile" },
};

// Helper to generate URL slug
function makeSlug(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Helper to generate database modal link (opens modal directly)
function getDatabaseLink(ttbId) {
  return `https://bevalcintel.com/database?ttb=${ttbId}`;
}

// Helper to group and sort filings by category
function groupByCategory(filings) {
  // Group by category
  const grouped = {};
  for (const filing of filings) {
    const cat = filing.category || 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(filing);
  }

  // Sort each group alphabetically by brand name
  for (const cat in grouped) {
    grouped[cat].sort((a, b) => (a.brand || '').localeCompare(b.brand || ''));
  }

  // Define category order (most common first)
  const categoryOrder = ['Whiskey', 'Tequila', 'Vodka', 'Wine', 'Beer', 'RTD', 'Gin', 'Rum', 'Brandy', 'Liqueur', 'Other'];

  // Sort categories by predefined order
  const sortedCategories = Object.keys(grouped).sort((a, b) => {
    const aIdx = categoryOrder.indexOf(a);
    const bIdx = categoryOrder.indexOf(b);
    if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  return { grouped, sortedCategories };
}

// Pro Badge Component
function ProBadge() {
  return (
    <span
      style={{
        display: "inline-block",
        backgroundColor: colors.primary,
        color: "#ffffff",
        fontSize: "10px",
        fontWeight: "700",
        padding: "3px 8px",
        borderRadius: "4px",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        marginLeft: "8px",
        verticalAlign: "middle",
      }}
    >
      Pro
    </span>
  );
}

// Stat Tile Component
function StatTile({ label, value, subtext, trend, highlight = false }) {
  return (
    <td
      style={{
        backgroundColor: highlight ? colors.primaryLight : colors.bg,
        border: `1px solid ${highlight ? colors.primary : colors.border}`,
        borderRadius: "8px",
        padding: "16px",
        textAlign: "center",
        width: "33%",
        verticalAlign: "top",
      }}
    >
      <Text
        style={{
          fontSize: "28px",
          fontWeight: "700",
          color: highlight ? colors.primaryDark : colors.primary,
          margin: "0",
          lineHeight: "1.2",
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          fontSize: "11px",
          color: highlight ? colors.primaryDark : colors.textSecondary,
          margin: "4px 0 0 0",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        {label}
      </Text>
      {subtext && (
        <Text
          style={{
            fontSize: "11px",
            color:
              trend === "up"
                ? colors.green
                : trend === "down"
                  ? colors.red
                  : colors.textTertiary,
            margin: "4px 0 0 0",
          }}
        >
          {subtext}
        </Text>
      )}
    </td>
  );
}

// CSS Bar Chart Row - uses pixel widths for email client compatibility
function BarRow({ label, value, maxValue, color = colors.primary, link }) {
  // Calculate pixel width (max bar is 140px, min is 10px)
  const barWidthPx = Math.max(Math.round((value / maxValue) * 140), 10);
  const remainingPx = 140 - barWidthPx;

  const labelContent = link ? (
    <Link
      href={link}
      style={{
        color: colors.text,
        textDecoration: "none",
        fontWeight: "500",
      }}
    >
      {label}
    </Link>
  ) : (
    label
  );

  return (
    <tr>
      <td
        style={{
          padding: "8px 0",
          fontSize: "13px",
          fontWeight: "500",
          color: colors.text,
          width: "100px",
        }}
      >
        {labelContent}
      </td>
      <td
        style={{
          padding: "8px 0",
          fontSize: "13px",
          fontWeight: "600",
          color: colors.textSecondary,
          width: "50px",
          textAlign: "right",
        }}
      >
        {value.toLocaleString()}
      </td>
      <td style={{ padding: "8px 0 8px 12px" }}>
        <table
          cellPadding="0"
          cellSpacing="0"
          width="140"
          style={{
            backgroundColor: colors.bgTertiary,
            borderRadius: "4px",
          }}
        >
          <tbody>
            <tr>
              <td
                style={{
                  backgroundColor: color,
                  height: "14px",
                  width: `${barWidthPx}px`,
                  borderRadius: barWidthPx === 140 ? "4px" : "4px 0 0 4px",
                }}
              ></td>
              {remainingPx > 0 && (
                <td
                  style={{
                    height: "14px",
                    width: `${remainingPx}px`,
                  }}
                ></td>
              )}
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
  );
}

// Category Badge Component
function CategoryBadge({ category }) {
  const colorScheme = categoryColors[category] || categoryColors.default;
  return (
    <span
      style={{
        display: "inline-block",
        backgroundColor: colorScheme.bg,
        color: colorScheme.text,
        fontSize: "11px",
        fontWeight: "600",
        padding: "3px 8px",
        borderRadius: "4px",
      }}
    >
      {category}
    </span>
  );
}

// Signal Badge Component
function SignalBadge({ signal }) {
  const config = signalColors[signal] || signalColors.REFILE;
  return (
    <span
      style={{
        display: "inline-block",
        backgroundColor: config.bg,
        color: config.text,
        fontSize: "10px",
        fontWeight: "600",
        padding: "2px 6px",
        borderRadius: "3px",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
      }}
    >
      {config.label}
    </span>
  );
}

// Linked Company Name
function CompanyLink({ name, style = {} }) {
  const slug = makeSlug(name);
  return (
    <Link
      href={`https://bevalcintel.com/company/${slug}`}
      style={{
        color: colors.text,
        textDecoration: "none",
        fontWeight: "500",
        ...style,
      }}
    >
      {name}
    </Link>
  );
}

// Linked Brand Name
function BrandLink({ name, style = {} }) {
  const slug = makeSlug(name);
  return (
    <Link
      href={`https://bevalcintel.com/brand/${slug}`}
      style={{
        color: colors.text,
        textDecoration: "none",
        fontWeight: "500",
        ...style,
      }}
    >
      {name}
    </Link>
  );
}

// Watchlist Match Row
function WatchlistRow({ filing, index, totalRows }) {
  const isLast = index === totalRows - 1;
  return (
    <tr
      style={{
        backgroundColor: index % 2 === 0 ? colors.bg : colors.bgSecondary,
      }}
    >
      <td
        style={{
          padding: "10px 12px",
          fontSize: "13px",
          borderBottom: isLast ? "none" : `1px solid ${colors.border}`,
          wordBreak: "break-word",
        }}
      >
        <Link
          href={getDatabaseLink(filing.ttbId)}
          style={{ color: colors.text, fontWeight: "600", textDecoration: "none" }}
        >
          {filing.brand}
        </Link>
      </td>
      <td
        style={{
          padding: "10px 12px",
          fontSize: "13px",
          borderBottom: isLast ? "none" : `1px solid ${colors.border}`,
          wordBreak: "break-word",
        }}
      >
        <CompanyLink name={filing.company} />
      </td>
      <td
        style={{
          padding: "8px",
          borderBottom: isLast ? "none" : `1px solid ${colors.border}`,
          width: "60px",
        }}
      >
        <SignalBadge signal={filing.signal} />
      </td>
      <td
        style={{
          padding: "8px",
          borderBottom: isLast ? "none" : `1px solid ${colors.border}`,
          textAlign: "center",
          width: "40px",
        }}
      >
        <CategoryBadge category={filing.category} />
      </td>
    </tr>
  );
}

// Section Header Component
function SectionHeader({ title, subtitle, color = colors.text, icon }) {
  return (
    <>
      <Text
        style={{
          fontSize: "14px",
          fontWeight: "700",
          color: color,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          margin: "0 0 4px 0",
        }}
      >
        {icon && <span style={{ marginRight: "6px" }}>{icon}</span>}
        {title}
      </Text>
      {subtitle && (
        <Text
          style={{
            fontSize: "12px",
            color: colors.textTertiary,
            margin: "0 0 16px 0",
          }}
        >
          {subtitle}
        </Text>
      )}
    </>
  );
}

// Category icons mapping
const categoryIcons = {
  Whiskey: "🥃",
  Vodka: "🍸",
  Tequila: "🌵",
  Rum: "🏝️",
  Gin: "🫒",
  Brandy: "🍇",
  Wine: "🍷",
  Beer: "🍺",
  Liqueur: "🍬",
  RTD: "🥤",
};

// Category Report Section Component
function CategoryReportSection({ category, data, weekStartDate, weekEndDate }) {
  const colorScheme = categoryColors[category] || categoryColors.default;
  const icon = categoryIcons[category] || "📦";
  const hasNewBrands = data.newBrands && data.newBrands.length > 0;
  const hasNewSkus = data.newSkus && data.newSkus.length > 0;
  const hasTopCompanies = data.topCompanies && data.topCompanies.length > 0;

  // Build database filter URL for this category
  const databaseFilterUrl = weekStartDate && weekEndDate
    ? `https://bevalcintel.com/database?category=${encodeURIComponent(category)}&date_from=${weekStartDate}&date_to=${weekEndDate}`
    : `https://bevalcintel.com/database?category=${encodeURIComponent(category)}`;

  return (
    <>
      <Hr style={{ borderTop: `2px solid ${colorScheme.text}`, margin: "24px 0" }} />

      {/* Category Header */}
      <Text
        style={{
          fontSize: "18px",
          fontWeight: "700",
          color: colorScheme.text,
          margin: "0 0 4px 0",
        }}
      >
        {icon} {category} Report
      </Text>
      <Text
        style={{
          fontSize: "13px",
          color: colors.textSecondary,
          margin: "0 0 16px 0",
        }}
      >
        {data.totalFilings} filings this week
        {data.change && ` (${data.change} vs last week)`}
      </Text>

      {/* New Brands in Category */}
      {hasNewBrands && (
        <>
          <Text
            style={{
              fontSize: "12px",
              fontWeight: "600",
              color: colorScheme.text,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              margin: "0 0 8px 0",
            }}
          >
            New Brands
          </Text>
          <table
            width="100%"
            cellPadding="0"
            cellSpacing="0"
            style={{
              borderRadius: "8px",
              border: `1px solid ${colorScheme.text}`,
              borderCollapse: "separate",
              overflow: "hidden",
              marginBottom: "16px",
            }}
          >
            <tbody>
              <tr style={{ backgroundColor: colorScheme.bg }}>
                <td style={{ padding: "8px 12px", fontSize: "11px", fontWeight: "600", color: colorScheme.text, textTransform: "uppercase", borderBottom: `1px solid ${colors.border}` }}>Brand</td>
                <td style={{ padding: "8px 12px", fontSize: "11px", fontWeight: "600", color: colorScheme.text, textTransform: "uppercase", borderBottom: `1px solid ${colors.border}` }}>Company</td>
              </tr>
              {data.newBrands.slice(0, 5).map((item, i) => (
                <tr key={i} style={{ backgroundColor: i % 2 === 0 ? colors.bg : colors.bgSecondary }}>
                  <td style={{ padding: "10px 12px", fontSize: "13px", borderBottom: i < Math.min(data.newBrands.length, 5) - 1 ? `1px solid ${colors.border}` : "none", wordBreak: "break-word" }}>
                    <Link href={getDatabaseLink(item.ttbId)} style={{ color: colors.text, fontWeight: "500", textDecoration: "none" }}>{item.brand}</Link>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: "13px", color: colors.textSecondary, borderBottom: i < Math.min(data.newBrands.length, 5) - 1 ? `1px solid ${colors.border}` : "none", wordBreak: "break-word" }}>
                    <CompanyLink name={item.company} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* New SKUs in Category */}
      {hasNewSkus && (
        <>
          <Text
            style={{
              fontSize: "12px",
              fontWeight: "600",
              color: colorScheme.text,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              margin: "0 0 8px 0",
            }}
          >
            New SKUs
          </Text>
          <table
            width="100%"
            cellPadding="0"
            cellSpacing="0"
            style={{
              borderRadius: "8px",
              border: `1px solid ${colors.border}`,
              borderCollapse: "separate",
              overflow: "hidden",
              marginBottom: "16px",
            }}
          >
            <tbody>
              <tr style={{ backgroundColor: colors.bgTertiary }}>
                <td style={{ padding: "8px 12px", fontSize: "11px", fontWeight: "600", color: colors.textSecondary, textTransform: "uppercase", borderBottom: `1px solid ${colors.border}` }}>Brand / Product</td>
                <td style={{ padding: "8px 12px", fontSize: "11px", fontWeight: "600", color: colors.textSecondary, textTransform: "uppercase", borderBottom: `1px solid ${colors.border}` }}>Company</td>
              </tr>
              {data.newSkus.slice(0, 5).map((item, i) => (
                <tr key={i} style={{ backgroundColor: i % 2 === 0 ? colors.bg : colors.bgSecondary }}>
                  <td style={{ padding: "10px 12px", fontSize: "13px", borderBottom: i < Math.min(data.newSkus.length, 5) - 1 ? `1px solid ${colors.border}` : "none", wordBreak: "break-word" }}>
                    <Link href={getDatabaseLink(item.ttbId)} style={{ color: colors.text, fontWeight: "500", textDecoration: "none" }}>{item.brand}</Link>
                    {item.fancifulName && item.fancifulName !== item.brand && (
                      <Text style={{ fontSize: "11px", color: colors.textTertiary, margin: "2px 0 0 0", wordBreak: "break-word" }}>{item.fancifulName}</Text>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: "13px", color: colors.textSecondary, borderBottom: i < Math.min(data.newSkus.length, 5) - 1 ? `1px solid ${colors.border}` : "none", wordBreak: "break-word" }}>
                    <CompanyLink name={item.company} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Top Companies in Category */}
      {hasTopCompanies && (
        <>
          <Text
            style={{
              fontSize: "12px",
              fontWeight: "600",
              color: colorScheme.text,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              margin: "0 0 8px 0",
            }}
          >
            Top Filers in {category}
          </Text>
          <table
            width="100%"
            cellPadding="0"
            cellSpacing="0"
            style={{
              borderRadius: "8px",
              border: `1px solid ${colors.border}`,
              borderCollapse: "separate",
              overflow: "hidden",
              marginBottom: "8px",
            }}
          >
            <tbody>
              {data.topCompanies.slice(0, 3).map((item, i) => (
                <tr key={i} style={{ backgroundColor: i % 2 === 0 ? colors.bg : colors.bgSecondary }}>
                  <td style={{ padding: "10px 12px", fontSize: "13px", borderBottom: i < Math.min(data.topCompanies.length, 3) - 1 ? `1px solid ${colors.border}` : "none" }}>
                    <CompanyLink name={item.company} style={{ fontWeight: "500" }} />
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: "13px", fontWeight: "600", color: colors.text, borderBottom: i < Math.min(data.topCompanies.length, 3) - 1 ? `1px solid ${colors.border}` : "none", textAlign: "right", width: "80px" }}>
                    {item.filings} filings
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Link to category page */}
      {/* View all in database link */}
      <Section
        style={{
          backgroundColor: colorScheme.bg,
          borderRadius: "6px",
          padding: "12px 16px",
          marginTop: "12px",
        }}
      >
        <Link
          href={databaseFilterUrl}
          style={{
            color: colorScheme.text,
            fontSize: "13px",
            fontWeight: "600",
            textDecoration: "none",
          }}
        >
          View all {category} filings in database →
        </Link>
      </Section>
    </>
  );
}

// Main Pro Weekly Report Component
export function ProWeeklyReport({
  // Personalization
  email = "subscriber@example.com",
  watchedCompaniesCount = 5,
  watchedBrandsCount = 12,

  // Week info
  weekEnding = "January 5, 2026",
  summary = "Tequila filings up 23% as brands prep for spring launches",

  // Stat tiles
  totalFilings = "2,847",
  newBrands = "127",
  newSkus = "843",
  newCompanies = "34",
  topFiler = "Diageo",
  topFilerCount = "89",
  weekOverWeekChange = "+12%",

  // Watchlist activity - NEW filings from tracked brands/companies
  watchlistMatches = [],

  // Category data (user's subscribed categories with breakdown)
  categoryData = [],

  // Top filing companies (velocity signals)
  topCompaniesList = [],

  // Notable new brands (first-time filers)
  notableNewBrands = [],

  // Filing spikes (M&A signals - companies with unusual activity)
  filingSpikes = [],

  // Full new brands & SKUs list (unlocked for Pro)
  newFilingsList = [],

  // Category-specific reports (based on user's subscribed categories)
  categoryReports = [],

  // Links
  databaseUrl = "https://bevalcintel.com/database",
  accountUrl = "https://bevalcintel.com/account.html",
  preferencesUrl = "https://bevalcintel.com/preferences.html",

  // Date range for CSV export link (YYYY-MM-DD format)
  weekStartDate = "",
  weekEndDate = "",
}) {
  const maxCategoryValue = categoryData.length > 0
    ? Math.max(...categoryData.map((d) => d.value))
    : 0;

  // Build filtered database URL with date and signal filters
  const newFilingsUrl = weekStartDate && weekEndDate
    ? `${databaseUrl}?date_from=${weekStartDate}&date_to=${weekEndDate}&signal=NEW_BRAND,NEW_SKU`
    : `${databaseUrl}?signal=NEW_BRAND,NEW_SKU`;
  const greeting = "Your";
  const hasWatchlistMatches = watchlistMatches && watchlistMatches.length > 0;
  const hasFilingSpikes = filingSpikes && filingSpikes.length > 0;
  const hasCategoryReports = categoryReports && categoryReports.length > 0;

  return (
    <Html>
      <Head />
      <Preview>
        Pro Report: {totalFilings} filings, {newBrands} new brands
        {hasWatchlistMatches
          ? ` + ${watchlistMatches.length} watchlist matches`
          : ""}{" "}
        - {weekEnding}
      </Preview>
      <Body
        style={{
          backgroundColor: colors.bgSecondary,
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          margin: 0,
          padding: 0,
        }}
      >
        <Container
          style={{
            margin: "0 auto",
            padding: "24px 16px",
            maxWidth: "600px",
          }}
        >
          {/* Header */}
          <Section style={{ textAlign: "center", marginBottom: "24px" }}>
            <Link
              href="https://bevalcintel.com"
              style={{
                color: colors.primary,
                fontSize: "20px",
                fontWeight: "600",
                textDecoration: "none",
              }}
            >
              BevAlc Intelligence
            </Link>
            <ProBadge />
            <Text
              style={{
                fontSize: "13px",
                color: colors.textTertiary,
                margin: "4px 0 0 0",
              }}
            >
              Weekly Pro Report
            </Text>
          </Section>

          {/* Main Card */}
          <Section
            style={{
              backgroundColor: colors.bg,
              borderRadius: "12px",
              border: `1px solid ${colors.border}`,
              padding: "24px",
            }}
          >
            {/* Personalized Greeting */}
            <Text
              style={{
                fontSize: "12px",
                color: colors.textTertiary,
                textTransform: "uppercase",
                letterSpacing: "1px",
                margin: "0 0 4px 0",
              }}
            >
              Week Ending {weekEnding}
            </Text>
            <Heading
              style={{
                fontSize: "20px",
                fontWeight: "700",
                color: colors.text,
                margin: "0 0 8px 0",
                lineHeight: "1.3",
              }}
            >
              {greeting} weekly intel
            </Heading>
            <Text
              style={{
                fontSize: "15px",
                color: colors.textSecondary,
                margin: "0 0 8px 0",
                lineHeight: "1.5",
              }}
            >
              {summary}
            </Text>
            <Text
              style={{
                fontSize: "12px",
                color: colors.textTertiary,
                margin: "0 0 20px 0",
              }}
            >
              You're tracking{" "}
              <strong style={{ color: colors.text }}>
                {watchedCompaniesCount} companies
              </strong>{" "}
              and{" "}
              <strong style={{ color: colors.text }}>
                {watchedBrandsCount} brands
              </strong>
            </Text>

            {/* Stat Tiles - Row 1 */}
            <table
              width="100%"
              cellPadding="0"
              cellSpacing="8"
              style={{ marginBottom: "8px" }}
            >
              <tbody>
                <tr>
                  <StatTile
                    label="Total Filings"
                    value={totalFilings}
                    subtext={weekOverWeekChange}
                    trend={weekOverWeekChange.startsWith("+") ? "up" : "down"}
                  />
                  <StatTile
                    label="New Brands"
                    value={newBrands}
                    highlight={true}
                  />
                  <StatTile label="New SKUs" value={newSkus} />
                </tr>
              </tbody>
            </table>

            {/* Stat Tiles - Row 2 */}
            <table
              width="100%"
              cellPadding="0"
              cellSpacing="8"
              style={{ marginBottom: "12px" }}
            >
              <tbody>
                <tr>
                  <StatTile label="New Companies" value={newCompanies} />
                  <StatTile
                    label="Categories"
                    value={categoryData.length}
                    subtext="active"
                  />
                  <StatTile
                    label="Watchlist"
                    value={hasWatchlistMatches ? watchlistMatches.length : "0"}
                    subtext="matches"
                    highlight={hasWatchlistMatches}
                  />
                </tr>
              </tbody>
            </table>

            {/* Top Filer callout */}
            <Text
              style={{
                fontSize: "13px",
                color: colors.textSecondary,
                margin: "0 0 24px 0",
                textAlign: "center",
              }}
            >
              Top filer this week:{" "}
              <Link
                href={`https://bevalcintel.com/company/${makeSlug(topFiler)}`}
                style={{ color: colors.primary, fontWeight: "600", textDecoration: "none" }}
              >
                {topFiler}
              </Link>
              {" "}with {topFilerCount} filings
            </Text>

            {/* WATCHLIST ACTIVITY SECTION */}
            {hasWatchlistMatches && (
              <>
                <Hr
                  style={{
                    borderTop: `2px solid ${colors.primary}`,
                    margin: "24px 0",
                  }}
                />

                <SectionHeader
                  title="Watchlist Activity"
                  subtitle="New filings from your tracked brands and companies"
                  color={colors.primary}
                />

                <table
                  width="100%"
                  cellPadding="0"
                  cellSpacing="0"
                  style={{
                    borderRadius: "8px",
                    border: `2px solid ${colors.primary}`,
                    borderCollapse: "separate",
                    overflow: "hidden",
                    marginBottom: "24px",
                  }}
                >
                  <tbody>
                    {/* Header Row */}
                    <tr style={{ backgroundColor: colors.primaryLight }}>
                      <td
                        style={{
                          padding: "10px 12px",
                          fontSize: "11px",
                          fontWeight: "600",
                          color: colors.primaryDark,
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                          borderBottom: `1px solid ${colors.border}`,
                        }}
                      >
                        Brand / Product
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          fontSize: "11px",
                          fontWeight: "600",
                          color: colors.primaryDark,
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                          borderBottom: `1px solid ${colors.border}`,
                        }}
                      >
                        Company
                      </td>
                      <td
                        style={{
                          padding: "10px 8px",
                          fontSize: "11px",
                          fontWeight: "600",
                          color: colors.primaryDark,
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                          borderBottom: `1px solid ${colors.border}`,
                          width: "60px",
                        }}
                      >
                        Signal
                      </td>
                      <td
                        style={{
                          padding: "10px 8px",
                          fontSize: "11px",
                          fontWeight: "600",
                          color: colors.primaryDark,
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                          borderBottom: `1px solid ${colors.border}`,
                          width: "40px",
                          textAlign: "center",
                        }}
                      >
                      </td>
                    </tr>
                    {/* Data Rows */}
                    {watchlistMatches.map((filing, i) => (
                      <WatchlistRow
                        key={i}
                        filing={filing}
                        index={i}
                        totalRows={watchlistMatches.length}
                      />
                    ))}
                  </tbody>
                </table>

                <Section style={{ textAlign: "center", marginBottom: "24px" }}>
                  <Link
                    href={accountUrl}
                    style={{
                      color: colors.primary,
                      fontSize: "13px",
                      fontWeight: "500",
                      textDecoration: "none",
                    }}
                  >
                    Manage your watchlist
                  </Link>
                </Section>
              </>
            )}

            <Hr style={{ borderTop: `1px solid ${colors.border}`, margin: "24px 0" }} />

            {/* Category Breakdown */}
            <SectionHeader
              title="Filings by Category"
              subtitle="Unique filings across all categories this week"
            />
            <table
              width="100%"
              cellPadding="0"
              cellSpacing="0"
              style={{ marginBottom: "24px" }}
            >
              <tbody>
                {categoryData.map((item, i) => (
                  <BarRow
                    key={i}
                    label={item.label}
                    value={item.value}
                    maxValue={maxCategoryValue}
                    link={`https://bevalcintel.com/category/${makeSlug(item.label)}/${new Date().getFullYear()}`}
                  />
                ))}
              </tbody>
            </table>

            {/* Primary CTA */}
            <Section style={{ textAlign: "center", margin: "24px 0" }}>
              <Button
                href={databaseUrl}
                style={{
                  backgroundColor: colors.primary,
                  borderRadius: "8px",
                  color: "#ffffff",
                  fontSize: "15px",
                  fontWeight: "600",
                  textDecoration: "none",
                  textAlign: "center",
                  display: "inline-block",
                  padding: "14px 28px",
                }}
              >
                Search All Filings in Database
              </Button>
            </Section>

            <Hr style={{ borderTop: `1px solid ${colors.border}`, margin: "24px 0" }} />

            {/* Top Filing Companies (Velocity Signals) */}
            <SectionHeader
              title="Top Filers This Week"
              subtitle="Companies with the most filing activity"
            />
            <table
              width="100%"
              cellPadding="0"
              cellSpacing="0"
              style={{
                borderRadius: "8px",
                border: `1px solid ${colors.border}`,
                borderCollapse: "separate",
                overflow: "hidden",
                marginBottom: "24px",
              }}
            >
              <tbody>
                {/* Header Row */}
                <tr style={{ backgroundColor: colors.greenLight }}>
                  <td
                    style={{
                      padding: "10px 12px",
                      fontSize: "11px",
                      fontWeight: "600",
                      color: colors.green,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      borderBottom: `1px solid ${colors.border}`,
                    }}
                  >
                    Company
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      fontSize: "11px",
                      fontWeight: "600",
                      color: colors.green,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      borderBottom: `1px solid ${colors.border}`,
                      width: "70px",
                      textAlign: "center",
                    }}
                  >
                    Filings
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      fontSize: "11px",
                      fontWeight: "600",
                      color: colors.green,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      borderBottom: `1px solid ${colors.border}`,
                      width: "70px",
                      textAlign: "center",
                    }}
                  >
                    vs Avg
                  </td>
                </tr>
                {/* Data Rows */}
                {topCompaniesList.map((row, i) => (
                  <tr
                    key={i}
                    style={{
                      backgroundColor: i % 2 === 0 ? colors.bg : colors.bgSecondary,
                    }}
                  >
                    <td
                      style={{
                        padding: "12px",
                        fontSize: "13px",
                        borderBottom:
                          i < topCompaniesList.length - 1
                            ? `1px solid ${colors.border}`
                            : "none",
                      }}
                    >
                      <CompanyLink name={row.company} />
                    </td>
                    <td
                      style={{
                        padding: "12px",
                        fontSize: "14px",
                        fontWeight: "600",
                        color: colors.text,
                        borderBottom:
                          i < topCompaniesList.length - 1
                            ? `1px solid ${colors.border}`
                            : "none",
                        textAlign: "center",
                      }}
                    >
                      {row.filings}
                    </td>
                    <td
                      style={{
                        padding: "12px",
                        fontSize: "12px",
                        fontWeight: "600",
                        color: row.change.startsWith("+")
                          ? colors.green
                          : row.change.startsWith("-")
                            ? colors.red
                            : colors.textTertiary,
                        borderBottom:
                          i < topCompaniesList.length - 1
                            ? `1px solid ${colors.border}`
                            : "none",
                        textAlign: "center",
                      }}
                    >
                      {row.change}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Filing Spikes (M&A Signals) */}
            {hasFilingSpikes && (
              <>
                <SectionHeader
                  title="Unusual Filing Activity"
                  subtitle="Companies with significant spikes vs. their 4-week average"
                  color={colors.orange}
                />
                <table
                  width="100%"
                  cellPadding="0"
                  cellSpacing="0"
                  style={{
                    borderRadius: "8px",
                    border: `1px solid ${colors.orange}`,
                    borderCollapse: "separate",
                    overflow: "hidden",
                    marginBottom: "24px",
                  }}
                >
                  <tbody>
                    {/* Header Row */}
                    <tr style={{ backgroundColor: colors.orangeLight }}>
                      <td
                        style={{
                          padding: "10px 12px",
                          fontSize: "11px",
                          fontWeight: "600",
                          color: colors.orange,
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                          borderBottom: `1px solid ${colors.border}`,
                        }}
                      >
                        Company
                      </td>
                      <td
                        style={{
                          padding: "10px 8px",
                          fontSize: "11px",
                          fontWeight: "600",
                          color: colors.orange,
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                          borderBottom: `1px solid ${colors.border}`,
                          width: "55px",
                          textAlign: "center",
                        }}
                      >
                        Week
                      </td>
                      <td
                        style={{
                          padding: "10px 8px",
                          fontSize: "11px",
                          fontWeight: "600",
                          color: colors.orange,
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                          borderBottom: `1px solid ${colors.border}`,
                          width: "55px",
                          textAlign: "center",
                        }}
                      >
                        Avg
                      </td>
                      <td
                        style={{
                          padding: "10px 8px",
                          fontSize: "11px",
                          fontWeight: "600",
                          color: colors.orange,
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                          borderBottom: `1px solid ${colors.border}`,
                          width: "55px",
                          textAlign: "center",
                        }}
                      >
                        Spike
                      </td>
                    </tr>
                    {/* Data Rows */}
                    {filingSpikes.map((row, i) => (
                      <tr
                        key={i}
                        style={{
                          backgroundColor:
                            i % 2 === 0 ? colors.bg : colors.bgSecondary,
                        }}
                      >
                        <td
                          style={{
                            padding: "12px",
                            fontSize: "13px",
                            borderBottom:
                              i < filingSpikes.length - 1
                                ? `1px solid ${colors.border}`
                                : "none",
                            wordBreak: "break-word",
                          }}
                        >
                          <CompanyLink name={row.company} />
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            fontSize: "13px",
                            fontWeight: "600",
                            color: colors.text,
                            borderBottom:
                              i < filingSpikes.length - 1
                                ? `1px solid ${colors.border}`
                                : "none",
                            textAlign: "center",
                            width: "55px",
                          }}
                        >
                          {row.thisWeek}
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            fontSize: "13px",
                            color: colors.textTertiary,
                            borderBottom:
                              i < filingSpikes.length - 1
                                ? `1px solid ${colors.border}`
                                : "none",
                            textAlign: "center",
                            width: "55px",
                          }}
                        >
                          {row.avgWeek}
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            fontSize: "12px",
                            fontWeight: "700",
                            color: colors.orange,
                            borderBottom:
                              i < filingSpikes.length - 1
                                ? `1px solid ${colors.border}`
                                : "none",
                            textAlign: "center",
                            width: "55px",
                          }}
                        >
                          +{row.percentIncrease}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {/* Notable New Brands */}
            <SectionHeader
              title="Notable New Brands"
              subtitle="First-time brand filings worth watching"
              color={colors.purple}
            />
            <table
              width="100%"
              cellPadding="0"
              cellSpacing="0"
              style={{
                borderRadius: "8px",
                border: `1px solid ${colors.border}`,
                borderCollapse: "separate",
                overflow: "hidden",
                marginBottom: "24px",
              }}
            >
              <tbody>
                {/* Header Row */}
                <tr style={{ backgroundColor: colors.purpleLight }}>
                  <td
                    style={{
                      padding: "10px 12px",
                      fontSize: "11px",
                      fontWeight: "600",
                      color: colors.purple,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      borderBottom: `1px solid ${colors.border}`,
                      width: "40%",
                    }}
                  >
                    Brand
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      fontSize: "11px",
                      fontWeight: "600",
                      color: colors.purple,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      borderBottom: `1px solid ${colors.border}`,
                      width: "45%",
                    }}
                  >
                    Company
                  </td>
                  <td
                    style={{
                      padding: "10px 8px",
                      fontSize: "11px",
                      fontWeight: "600",
                      color: colors.purple,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      borderBottom: `1px solid ${colors.border}`,
                      width: "50px",
                    }}
                  >
                    Category
                  </td>
                </tr>
                {/* Data Rows */}
                {notableNewBrands.map((row, i) => (
                  <tr
                    key={i}
                    style={{
                      backgroundColor: i % 2 === 0 ? colors.bg : colors.bgSecondary,
                    }}
                  >
                    <td
                      style={{
                        padding: "10px 12px",
                        fontSize: "13px",
                        fontWeight: "500",
                        borderBottom:
                          i < notableNewBrands.length - 1
                            ? `1px solid ${colors.border}`
                            : "none",
                        wordBreak: "break-word",
                        width: "40%",
                      }}
                    >
                      <Link
                        href={getDatabaseLink(row.ttbId)}
                        style={{ color: colors.text, fontWeight: "500", textDecoration: "none" }}
                      >
                        {row.brand}
                      </Link>
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        fontSize: "13px",
                        color: colors.textSecondary,
                        borderBottom:
                          i < notableNewBrands.length - 1
                            ? `1px solid ${colors.border}`
                            : "none",
                        wordBreak: "break-word",
                        width: "45%",
                      }}
                    >
                      <CompanyLink name={row.company} />
                    </td>
                    <td
                      style={{
                        padding: "8px",
                        borderBottom:
                          i < notableNewBrands.length - 1
                            ? `1px solid ${colors.border}`
                            : "none",
                        width: "50px",
                        textAlign: "center",
                      }}
                    >
                      <CategoryBadge category={row.category} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Category-Specific Reports (based on user's subscribed categories) */}
            {hasCategoryReports && categoryReports.map((report, idx) => (
              <CategoryReportSection key={idx} category={report.category} data={report} weekStartDate={weekStartDate} weekEndDate={weekEndDate} />
            ))}

            <Hr style={{ borderTop: `1px solid ${colors.border}`, margin: "24px 0" }} />

            {/* Full New Filings List (UNLOCKED for Pro) - Grouped by Category */}
            <SectionHeader
              title="New Brands & SKUs Sample"
              subtitle={`${newBrands} new brands and ${newSkus} new SKUs filed this week — showing up to 7 per category`}
              color={colors.blue}
            />
            {(() => {
              const { grouped, sortedCategories } = groupByCategory(newFilingsList);
              return sortedCategories.map((category, catIdx) => {
                const categoryColorScheme = categoryColors[category] || categoryColors.default;
                const filings = grouped[category];
                return (
                  <React.Fragment key={catIdx}>
                    {/* Category Header */}
                    <Text
                      style={{
                        fontSize: "13px",
                        fontWeight: "700",
                        color: categoryColorScheme.text,
                        backgroundColor: categoryColorScheme.bg,
                        padding: "8px 12px",
                        borderRadius: "6px 6px 0 0",
                        margin: catIdx > 0 ? "16px 0 0 0" : "0",
                      }}
                    >
                      {categoryIcons[category] || "📦"} {category} ({filings.length})
                    </Text>
                    <table
                      width="100%"
                      cellPadding="0"
                      cellSpacing="0"
                      style={{
                        borderRadius: "0 0 8px 8px",
                        border: `1px solid ${colors.border}`,
                        borderTop: "none",
                        borderCollapse: "separate",
                        overflow: "hidden",
                        marginBottom: "0",
                      }}
                    >
                      <tbody>
                        {filings.map((row, i) => (
                          <tr
                            key={i}
                            style={{
                              backgroundColor: i % 2 === 0 ? colors.bg : colors.bgSecondary,
                            }}
                          >
                            <td
                              style={{
                                padding: "10px 12px",
                                fontSize: "13px",
                                borderBottom:
                                  i < filings.length - 1
                                    ? `1px solid ${colors.border}`
                                    : "none",
                                wordBreak: "break-word",
                                width: "45%",
                              }}
                            >
                              <Link
                                href={getDatabaseLink(row.ttbId)}
                                style={{
                                  color: colors.text,
                                  fontWeight: "600",
                                  textDecoration: "none",
                                }}
                              >
                                {row.brand}
                              </Link>
                            </td>
                            <td
                              style={{
                                padding: "10px 12px",
                                fontSize: "13px",
                                borderBottom:
                                  i < filings.length - 1
                                    ? `1px solid ${colors.border}`
                                    : "none",
                                wordBreak: "break-word",
                                width: "40%",
                              }}
                            >
                              <CompanyLink name={row.company} />
                            </td>
                            <td
                              style={{
                                padding: "6px 8px",
                                borderBottom:
                                  i < filings.length - 1
                                    ? `1px solid ${colors.border}`
                                    : "none",
                                width: "15%",
                                textAlign: "center",
                              }}
                            >
                              <SignalBadge signal={row.signal} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </React.Fragment>
                );
              });
            })()}

            {/* View all this week's filings CTA */}
            <Section
              style={{
                backgroundColor: colors.primaryLight,
                borderRadius: "8px",
                padding: "16px",
                textAlign: "center",
                marginTop: "16px",
              }}
            >
              <Link
                href={newFilingsUrl}
                style={{
                  color: colors.primaryDark,
                  fontSize: "14px",
                  fontWeight: "600",
                  textDecoration: "none",
                }}
              >
                View all {parseInt(newBrands) + parseInt(newSkus)} new filings in database →
              </Link>
            </Section>
          </Section>

          {/* Footer */}
          <Section style={{ textAlign: "center", marginTop: "24px" }}>
            <Text
              style={{
                fontSize: "12px",
                color: colors.textTertiary,
                margin: "0 0 8px 0",
              }}
            >
              You're receiving this because you have an active Pro subscription.
            </Text>
            <Text
              style={{
                fontSize: "12px",
                color: colors.textTertiary,
                margin: "0",
                lineHeight: "1.6",
              }}
            >
              <Link
                href="https://bevalcintel.com"
                style={{ color: colors.textTertiary }}
              >
                bevalcintel.com
              </Link>
              {" | "}
              <Link href={accountUrl} style={{ color: colors.textTertiary }}>
                Manage preferences
              </Link>
            </Text>
            <Text
              style={{
                fontSize: "11px",
                color: colors.textTertiary,
                margin: "16px 0 0 0",
              }}
            >
              &copy; {new Date().getFullYear()} BevAlc Intelligence. All rights reserved.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default ProWeeklyReport;
