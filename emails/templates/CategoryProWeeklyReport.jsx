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
  Whiskey: { bg: "#fef3c7", text: "#92400e", accent: "#d97706" },
  Tequila: { bg: "#d1fae5", text: "#065f46", accent: "#059669" },
  Vodka: { bg: "#dbeafe", text: "#1e40af", accent: "#2563eb" },
  Wine: { bg: "#fce7f3", text: "#9d174d", accent: "#db2777" },
  Beer: { bg: "#fed7aa", text: "#9a3412", accent: "#ea580c" },
  RTD: { bg: "#e0e7ff", text: "#3730a3", accent: "#4f46e5" },
  Gin: { bg: "#ccfbf1", text: "#0f766e", accent: "#0d9488" },
  Rum: { bg: "#fecaca", text: "#991b1b", accent: "#dc2626" },
  Brandy: { bg: "#f5d0fe", text: "#86198f", accent: "#c026d3" },
  Liqueur: { bg: "#fef9c3", text: "#854d0e", accent: "#ca8a04" },
  Other: { bg: "#f1f5f9", text: "#475569", accent: "#64748b" },
  default: { bg: "#f1f5f9", text: "#475569", accent: "#64748b" },
};

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
  Other: "📦",
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

// Helper to generate database modal link
function getDatabaseLink(ttbId) {
  return `https://bevalcintel.com/database?ttb=${ttbId}`;
}

// Category Pro Badge Component
function CategoryProBadge({ category }) {
  const colorScheme = categoryColors[category] || categoryColors.default;
  return (
    <span
      style={{
        display: "inline-block",
        backgroundColor: colorScheme.accent,
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
      Category Pro
    </span>
  );
}

// Stat Tile Component
function StatTile({ label, value, subtext, trend, highlight = false, accentColor }) {
  const highlightBg = accentColor ? `${accentColor}15` : colors.primaryLight;
  const highlightBorder = accentColor || colors.primary;
  const highlightText = accentColor || colors.primaryDark;

  return (
    <td
      style={{
        backgroundColor: highlight ? highlightBg : colors.bg,
        border: `1px solid ${highlight ? highlightBorder : colors.border}`,
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
          color: highlight ? highlightText : colors.primary,
          margin: "0",
          lineHeight: "1.2",
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          fontSize: "11px",
          color: highlight ? highlightText : colors.textSecondary,
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

// Section Header Component
function SectionHeader({ title, subtitle, color = colors.text }) {
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

// Main Category Pro Weekly Report Component
export function CategoryProWeeklyReport({
  // Category (the user's chosen category)
  tierCategory = "Whiskey",

  // Week info
  weekEnding = "January 5, 2026",

  // Category-specific stats
  categoryFilings = "127",
  categoryNewBrands = "23",
  categoryNewSkus = "64",
  categoryNewCompanies = "8",
  weekOverWeekChange = "+12%",

  // Watchlist (filtered to this category)
  watchedCompaniesCount = 5,
  watchedBrandsCount = 12,
  watchlistMatches = [],

  // Top filing companies in this category
  topCompaniesList = [],

  // Filing spikes in this category
  filingSpikes = [],

  // New brands in this category
  newBrands = [],

  // New SKUs in this category
  newSkus = [],

  // Links
  databaseUrl = "https://bevalcintel.com/database",
  accountUrl = "https://bevalcintel.com/account.html",

  // Date range
  weekStartDate = "",
  weekEndDate = "",
}) {
  const colorScheme = categoryColors[tierCategory] || categoryColors.default;
  const icon = categoryIcons[tierCategory] || "📦";
  const hasWatchlistMatches = watchlistMatches && watchlistMatches.length > 0;
  const hasFilingSpikes = filingSpikes && filingSpikes.length > 0;
  const hasNewBrands = newBrands && newBrands.length > 0;
  const hasNewSkus = newSkus && newSkus.length > 0;

  // Build filtered database URL for this category
  const categoryDatabaseUrl = weekStartDate && weekEndDate
    ? `${databaseUrl}?category=${encodeURIComponent(tierCategory)}&date_from=${weekStartDate}&date_to=${weekEndDate}`
    : `${databaseUrl}?category=${encodeURIComponent(tierCategory)}`;

  return (
    <Html>
      <Head />
      <Preview>
        Your {tierCategory} Weekly: {categoryFilings} filings, {categoryNewBrands} new brands - {weekEnding}
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
            <CategoryProBadge category={tierCategory} />
            <Text
              style={{
                fontSize: "13px",
                color: colors.textTertiary,
                margin: "4px 0 0 0",
              }}
            >
              Your {tierCategory} Weekly Report
            </Text>
            <Text
              style={{
                fontSize: "11px",
                color: colors.textTertiary,
                margin: "8px 0 0 0",
                fontStyle: "italic",
              }}
            >
              TTB publishes on a lag — data fills in over the following days
            </Text>
          </Section>

          {/* Main Card */}
          <Section
            style={{
              backgroundColor: colors.bg,
              borderRadius: "12px",
              border: `2px solid ${colorScheme.accent}`,
              padding: "24px",
            }}
          >
            {/* Personalized Category Header */}
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
                fontSize: "24px",
                fontWeight: "700",
                color: colorScheme.text,
                margin: "0 0 8px 0",
                lineHeight: "1.3",
              }}
            >
              {icon} Your {tierCategory} Weekly
            </Heading>
            <Text
              style={{
                fontSize: "14px",
                color: colors.textSecondary,
                margin: "0 0 20px 0",
              }}
            >
              Everything that happened in {tierCategory} last week.
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
                    label={`${tierCategory} Filings`}
                    value={categoryFilings}
                    subtext={weekOverWeekChange}
                    trend={weekOverWeekChange.startsWith("+") ? "up" : "down"}
                    highlight={true}
                    accentColor={colorScheme.accent}
                  />
                  <StatTile
                    label="New Brands"
                    value={categoryNewBrands}
                  />
                  <StatTile
                    label="New SKUs"
                    value={categoryNewSkus}
                  />
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
                  <StatTile
                    label="New Companies"
                    value={categoryNewCompanies}
                  />
                  <StatTile
                    label="Your Category"
                    value={icon}
                    subtext={tierCategory}
                  />
                  <StatTile
                    label="Watchlist"
                    value={hasWatchlistMatches ? watchlistMatches.length : "0"}
                    subtext="matches"
                    highlight={hasWatchlistMatches}
                    accentColor={colorScheme.accent}
                  />
                </tr>
              </tbody>
            </table>

            {/* Watchlist info */}
            <Text
              style={{
                fontSize: "12px",
                color: colors.textTertiary,
                margin: "0 0 24px 0",
                textAlign: "center",
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

            {/* Primary CTA */}
            <Section style={{ textAlign: "center", margin: "24px 0" }}>
              <Button
                href={categoryDatabaseUrl}
                style={{
                  backgroundColor: colorScheme.accent,
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
                View All {tierCategory} Filings
              </Button>
            </Section>

            {/* WATCHLIST ACTIVITY SECTION */}
            {hasWatchlistMatches && (
              <>
                <Hr
                  style={{
                    borderTop: `2px solid ${colorScheme.accent}`,
                    margin: "24px 0",
                  }}
                />

                <SectionHeader
                  title="Watchlist Activity"
                  subtitle={`New ${tierCategory} filings from your tracked companies`}
                  color={colorScheme.accent}
                />

                <table
                  width="100%"
                  cellPadding="0"
                  cellSpacing="0"
                  style={{
                    borderRadius: "8px",
                    border: `2px solid ${colorScheme.accent}`,
                    borderCollapse: "separate",
                    overflow: "hidden",
                    marginBottom: "24px",
                  }}
                >
                  <tbody>
                    <tr style={{ backgroundColor: colorScheme.bg }}>
                      <td style={{ padding: "10px 12px", fontSize: "11px", fontWeight: "600", color: colorScheme.text, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${colors.border}` }}>Brand</td>
                      <td style={{ padding: "10px 12px", fontSize: "11px", fontWeight: "600", color: colorScheme.text, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${colors.border}` }}>Company</td>
                      <td style={{ padding: "10px 8px", fontSize: "11px", fontWeight: "600", color: colorScheme.text, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${colors.border}`, width: "70px" }}>Signal</td>
                    </tr>
                    {watchlistMatches.slice(0, 10).map((filing, i) => (
                      <tr key={i} style={{ backgroundColor: i % 2 === 0 ? colors.bg : colors.bgSecondary }}>
                        <td style={{ padding: "10px 12px", fontSize: "13px", borderBottom: i < Math.min(watchlistMatches.length, 10) - 1 ? `1px solid ${colors.border}` : "none", wordBreak: "break-word" }}>
                          <Link href={getDatabaseLink(filing.ttbId)} style={{ color: colors.text, fontWeight: "600", textDecoration: "none" }}>{filing.brand}</Link>
                        </td>
                        <td style={{ padding: "10px 12px", fontSize: "13px", borderBottom: i < Math.min(watchlistMatches.length, 10) - 1 ? `1px solid ${colors.border}` : "none", wordBreak: "break-word" }}>
                          <CompanyLink name={filing.company} />
                        </td>
                        <td style={{ padding: "8px", borderBottom: i < Math.min(watchlistMatches.length, 10) - 1 ? `1px solid ${colors.border}` : "none", width: "70px" }}>
                          <SignalBadge signal={filing.signal} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            <Hr style={{ borderTop: `1px solid ${colors.border}`, margin: "24px 0" }} />

            {/* Top Filing Companies */}
            <SectionHeader
              title={`Top ${tierCategory} Filers`}
              subtitle="Companies with the most filings last week"
              color={colorScheme.text}
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
                <tr style={{ backgroundColor: colors.greenLight }}>
                  <td style={{ padding: "10px 12px", fontSize: "11px", fontWeight: "600", color: colors.green, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${colors.border}` }}>Company</td>
                  <td style={{ padding: "10px 12px", fontSize: "11px", fontWeight: "600", color: colors.green, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${colors.border}`, width: "70px", textAlign: "center" }}>Filings</td>
                  <td style={{ padding: "10px 12px", fontSize: "11px", fontWeight: "600", color: colors.green, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${colors.border}`, width: "70px", textAlign: "center" }}>vs Avg</td>
                </tr>
                {topCompaniesList.slice(0, 5).map((row, i) => (
                  <tr key={i} style={{ backgroundColor: i % 2 === 0 ? colors.bg : colors.bgSecondary }}>
                    <td style={{ padding: "12px", fontSize: "13px", borderBottom: i < Math.min(topCompaniesList.length, 5) - 1 ? `1px solid ${colors.border}` : "none" }}>
                      <CompanyLink name={row.company} />
                    </td>
                    <td style={{ padding: "12px", fontSize: "14px", fontWeight: "600", color: colors.text, borderBottom: i < Math.min(topCompaniesList.length, 5) - 1 ? `1px solid ${colors.border}` : "none", textAlign: "center" }}>
                      {row.filings}
                    </td>
                    <td style={{ padding: "12px", fontSize: "12px", fontWeight: "600", color: row.change && row.change.startsWith("+") ? colors.green : row.change && row.change.startsWith("-") ? colors.red : colors.textTertiary, borderBottom: i < Math.min(topCompaniesList.length, 5) - 1 ? `1px solid ${colors.border}` : "none", textAlign: "center" }}>
                      {row.change || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Filing Spikes */}
            {hasFilingSpikes && (
              <>
                <SectionHeader
                  title="Unusual Activity"
                  subtitle={`${tierCategory} filing spikes vs. 4-week average`}
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
                    <tr style={{ backgroundColor: colors.orangeLight }}>
                      <td style={{ padding: "10px 12px", fontSize: "11px", fontWeight: "600", color: colors.orange, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${colors.border}` }}>Company</td>
                      <td style={{ padding: "10px 8px", fontSize: "11px", fontWeight: "600", color: colors.orange, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${colors.border}`, width: "55px", textAlign: "center" }}>Week</td>
                      <td style={{ padding: "10px 8px", fontSize: "11px", fontWeight: "600", color: colors.orange, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${colors.border}`, width: "55px", textAlign: "center" }}>Avg</td>
                      <td style={{ padding: "10px 8px", fontSize: "11px", fontWeight: "600", color: colors.orange, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${colors.border}`, width: "55px", textAlign: "center" }}>Spike</td>
                    </tr>
                    {filingSpikes.map((row, i) => (
                      <tr key={i} style={{ backgroundColor: i % 2 === 0 ? colors.bg : colors.bgSecondary }}>
                        <td style={{ padding: "12px", fontSize: "13px", borderBottom: i < filingSpikes.length - 1 ? `1px solid ${colors.border}` : "none", wordBreak: "break-word" }}>
                          <CompanyLink name={row.company} />
                        </td>
                        <td style={{ padding: "8px", fontSize: "13px", fontWeight: "600", color: colors.text, borderBottom: i < filingSpikes.length - 1 ? `1px solid ${colors.border}` : "none", textAlign: "center", width: "55px" }}>
                          {row.thisWeek}
                        </td>
                        <td style={{ padding: "8px", fontSize: "13px", color: colors.textTertiary, borderBottom: i < filingSpikes.length - 1 ? `1px solid ${colors.border}` : "none", textAlign: "center", width: "55px" }}>
                          {row.avgWeek}
                        </td>
                        <td style={{ padding: "8px", fontSize: "12px", fontWeight: "700", color: colors.orange, borderBottom: i < filingSpikes.length - 1 ? `1px solid ${colors.border}` : "none", textAlign: "center", width: "55px" }}>
                          +{row.percentIncrease}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {/* New Brands */}
            {hasNewBrands && (
              <>
                <SectionHeader
                  title={`New ${tierCategory} Brands`}
                  subtitle="First-time brand filings last week"
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
                    <tr style={{ backgroundColor: colors.purpleLight }}>
                      <td style={{ padding: "10px 12px", fontSize: "11px", fontWeight: "600", color: colors.purple, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${colors.border}` }}>Brand</td>
                      <td style={{ padding: "10px 12px", fontSize: "11px", fontWeight: "600", color: colors.purple, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${colors.border}` }}>Company</td>
                    </tr>
                    {newBrands.slice(0, 10).map((row, i) => (
                      <tr key={i} style={{ backgroundColor: i % 2 === 0 ? colors.bg : colors.bgSecondary }}>
                        <td style={{ padding: "10px 12px", fontSize: "13px", fontWeight: "500", borderBottom: i < Math.min(newBrands.length, 10) - 1 ? `1px solid ${colors.border}` : "none", wordBreak: "break-word" }}>
                          <Link href={getDatabaseLink(row.ttbId)} style={{ color: colors.text, fontWeight: "500", textDecoration: "none" }}>{row.brand}</Link>
                        </td>
                        <td style={{ padding: "10px 12px", fontSize: "13px", color: colors.textSecondary, borderBottom: i < Math.min(newBrands.length, 10) - 1 ? `1px solid ${colors.border}` : "none", wordBreak: "break-word" }}>
                          <CompanyLink name={row.company} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {/* New SKUs */}
            {hasNewSkus && (
              <>
                <SectionHeader
                  title={`New ${tierCategory} SKUs`}
                  subtitle="New product variants last week"
                  color={colors.blue}
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
                    <tr style={{ backgroundColor: colors.blueLight }}>
                      <td style={{ padding: "10px 12px", fontSize: "11px", fontWeight: "600", color: colors.blue, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${colors.border}` }}>Brand / Product</td>
                      <td style={{ padding: "10px 12px", fontSize: "11px", fontWeight: "600", color: colors.blue, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `1px solid ${colors.border}` }}>Company</td>
                    </tr>
                    {newSkus.slice(0, 10).map((row, i) => (
                      <tr key={i} style={{ backgroundColor: i % 2 === 0 ? colors.bg : colors.bgSecondary }}>
                        <td style={{ padding: "10px 12px", fontSize: "13px", borderBottom: i < Math.min(newSkus.length, 10) - 1 ? `1px solid ${colors.border}` : "none", wordBreak: "break-word" }}>
                          <Link href={getDatabaseLink(row.ttbId)} style={{ color: colors.text, fontWeight: "500", textDecoration: "none" }}>{row.brand}</Link>
                          {row.fancifulName && row.fancifulName !== row.brand && (
                            <Text style={{ fontSize: "11px", color: colors.textTertiary, margin: "2px 0 0 0", wordBreak: "break-word" }}>{row.fancifulName}</Text>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px", fontSize: "13px", color: colors.textSecondary, borderBottom: i < Math.min(newSkus.length, 10) - 1 ? `1px solid ${colors.border}` : "none", wordBreak: "break-word" }}>
                          <CompanyLink name={row.company} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {/* View all CTA */}
            <Section
              style={{
                backgroundColor: colorScheme.bg,
                borderRadius: "8px",
                padding: "16px",
                textAlign: "center",
                marginTop: "16px",
              }}
            >
              <Link
                href={categoryDatabaseUrl}
                style={{
                  color: colorScheme.text,
                  fontSize: "14px",
                  fontWeight: "600",
                  textDecoration: "none",
                }}
              >
                View all {categoryFilings} {tierCategory} filings in database →
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
              You're receiving this because you have a Category Pro subscription for {tierCategory}.
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

export default CategoryProWeeklyReport;
