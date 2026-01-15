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

// Map category names to URL slugs (handles RTD → cocktails, etc.)
function getCategorySlug(category) {
  if (!category) return "other";
  const slugMap = {
    "RTD/Cocktails": "cocktails",
    "RTD": "cocktails",
    "Cocktails": "cocktails",
    "Whiskey": "whiskey",
    "Vodka": "vodka",
    "Tequila": "tequila",
    "Rum": "rum",
    "Gin": "gin",
    "Brandy": "brandy",
    "Wine": "wine",
    "Beer": "beer",
    "Liqueur": "liqueur",
    "Other": "other",
  };
  return slugMap[category] || makeSlug(category);
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

export function WeeklyReport({
  weekEnding = "January 5, 2026",
  summaryBullets = [],

  // Stat tiles
  totalFilings = "847",
  newBrands = "23",
  newSkus = "156",
  newCompanies = "8",
  topFiler = "Diageo",
  topFilerCount = "34",

  // Category bar chart data (total filings by category last week)
  categoryData = [
    { label: "Whiskey", value: 187 },
    { label: "Tequila", value: 156 },
    { label: "Vodka", value: 134 },
    { label: "Wine", value: 98 },
    { label: "Beer", value: 76 },
    { label: "RTD", value: 64 },
  ],

  // Top filing companies last week (ranked by total filings)
  topCompaniesList = [
    { company: "Diageo", category: "Whiskey", filings: 34 },
    { company: "Constellation Brands", category: "Beer", filings: 28 },
    { company: "Pernod Ricard", category: "Whiskey", filings: 22 },
    { company: "E&J Gallo", category: "Wine", filings: 19 },
    { company: "Brown-Forman", category: "Whiskey", filings: 16 },
  ],

  // Top brand extensions last week (brands with most NEW_SKU filings)
  topExtensionsList = [
    { brand: "Crown Royal", company: "Diageo", category: "Whiskey", newSkus: 14 },
    { brand: "High Noon", company: "E&J Gallo", category: "RTD", newSkus: 9 },
    { brand: "Modelo Especial", company: "Constellation", category: "Beer", newSkus: 8 },
    { brand: "Tito's Handmade", company: "Fifth Generation", category: "Vodka", newSkus: 6 },
    { brand: "Hendrick's", company: "William Grant", category: "Gin", newSkus: 5 },
  ],

  // Notable new brands preview (show 3 to free users)
  notableNewBrandsPreview = [
    { brand: "Casa Dragones", company: "Casa Dragones LLC", category: "Tequila" },
    { brand: "Kentucky Owl", company: "Kentucky Owl LLC", category: "Whiskey" },
    { brand: "Cutwater Spirits", company: "Cutwater Spirits LLC", category: "RTD" },
  ],

  // Links
  databaseUrl = "https://bevalcintel.com/database",
  pricingUrl = "https://bevalcintel.com/#pricing",
}) {
  const maxCategoryValue = categoryData.length > 0
    ? Math.max(...categoryData.map((d) => d.value))
    : 0;

  return (
    <Html>
      <Head />
      <Preview>BevAlc Weekly: {totalFilings} filings, {newBrands} new brands last week</Preview>
      <Body
        style={{
          backgroundColor: colors.bgSecondary,
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
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
            <Text
              style={{
                fontSize: "13px",
                color: colors.textTertiary,
                margin: "4px 0 0 0",
              }}
            >
              Weekly Market Snapshot
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
              border: `1px solid ${colors.border}`,
              padding: "24px",
            }}
          >
            {/* Week & Summary */}
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
              Last week in beverage alcohol
            </Heading>
            {/* Summary Bullets */}
            {summaryBullets && summaryBullets.length > 0 && (
              <table cellPadding="0" cellSpacing="0" style={{ marginBottom: "20px" }}>
                <tbody>
                  {summaryBullets.map((bullet, i) => (
                    <tr key={i}>
                      <td style={{ paddingRight: "8px", verticalAlign: "top", color: colors.primary }}>•</td>
                      <td style={{ fontSize: "14px", color: colors.textSecondary, lineHeight: "1.5", paddingBottom: "4px" }}>
                        {bullet}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Stat Tiles - Row 1 */}
            <table width="100%" cellPadding="0" cellSpacing="8" style={{ marginBottom: "8px" }}>
              <tbody>
                <tr>
                  <StatTile label="Total Filings" value={totalFilings} />
                  <StatTile label="New Brands" value={newBrands} highlight={true} />
                  <StatTile label="New SKUs" value={newSkus} />
                </tr>
              </tbody>
            </table>

            {/* Stat Tiles - Row 2 */}
            <table width="100%" cellPadding="0" cellSpacing="8" style={{ marginBottom: "12px" }}>
              <tbody>
                <tr>
                  <StatTile label="New Companies" value={newCompanies} />
                  <StatTile label="Categories" value={categoryData.length} subtext="active" />
                  <td style={{ width: "33%" }}></td>
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
              Top filer last week:{" "}
              <Link
                href={`https://bevalcintel.com/company/${makeSlug(topFiler)}`}
                style={{ color: colors.primary, fontWeight: "600", textDecoration: "none" }}
              >
                {topFiler}
              </Link>
              {" "}with {topFilerCount} filings
            </Text>

            <Hr style={{ borderTop: `1px solid ${colors.border}`, margin: "24px 0" }} />

            {/* Category Breakdown */}
            <SectionHeader
              title="Filings by Category"
              subtitle="Total approvals last week"
            />
            <table width="100%" cellPadding="0" cellSpacing="0" style={{ marginBottom: "24px" }}>
              <tbody>
                {categoryData.map((item, i) => (
                  <BarRow
                    key={i}
                    label={item.label}
                    value={item.value}
                    maxValue={maxCategoryValue}
                    link={`https://bevalcintel.com/${getCategorySlug(item.label)}/`}
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

            {/* Top Filing Companies */}
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
                      width: "40%",
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
                      width: "90px",
                    }}
                  >
                    Top Category
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
                        borderBottom:
                          i < topCompaniesList.length - 1
                            ? `1px solid ${colors.border}`
                            : "none",
                      }}
                    >
                      <CategoryBadge category={row.category} />
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
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Top Brand Extensions */}
            <SectionHeader
              title="Top Brand Extensions"
              subtitle="Brands adding the most new SKUs last week"
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
                <tr style={{ backgroundColor: colors.blueLight }}>
                  <td
                    style={{
                      padding: "10px 12px",
                      fontSize: "11px",
                      fontWeight: "600",
                      color: colors.blue,
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
                      color: colors.blue,
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
                      color: colors.blue,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      borderBottom: `1px solid ${colors.border}`,
                      width: "70px",
                      textAlign: "center",
                    }}
                  >
                    New SKUs
                  </td>
                </tr>
                {/* Data Rows */}
                {topExtensionsList.map((row, i) => (
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
                        fontWeight: "500",
                        color: colors.text,
                        borderBottom:
                          i < topExtensionsList.length - 1
                            ? `1px solid ${colors.border}`
                            : "none",
                      }}
                    >
                      <Link
                        href={`https://bevalcintel.com/brand/${makeSlug(row.brand)}`}
                        style={{ color: colors.text, textDecoration: "none" }}
                      >
                        {row.brand}
                      </Link>
                    </td>
                    <td
                      style={{
                        padding: "12px",
                        fontSize: "13px",
                        color: colors.textSecondary,
                        borderBottom:
                          i < topExtensionsList.length - 1
                            ? `1px solid ${colors.border}`
                            : "none",
                      }}
                    >
                      {row.company}
                    </td>
                    <td
                      style={{
                        padding: "12px",
                        fontSize: "14px",
                        fontWeight: "600",
                        color: colors.text,
                        borderBottom:
                          i < topExtensionsList.length - 1
                            ? `1px solid ${colors.border}`
                            : "none",
                        textAlign: "center",
                      }}
                    >
                      {row.newSkus}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <Hr style={{ borderTop: `1px solid ${colors.border}`, margin: "24px 0" }} />

            {/* Notable New Brands Preview */}
            <SectionHeader
              title="Notable New Brands"
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
                marginBottom: "16px",
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
                      width: "70px",
                    }}
                  >
                    Category
                  </td>
                </tr>
                {/* Data Rows */}
                {notableNewBrandsPreview.slice(0, 3).map((row, i) => (
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
                        fontWeight: "500",
                        color: colors.text,
                        borderBottom:
                          i < Math.min(notableNewBrandsPreview.length, 3) - 1
                            ? `1px solid ${colors.border}`
                            : "none",
                      }}
                    >
                      {row.brand}
                    </td>
                    <td
                      style={{
                        padding: "12px",
                        fontSize: "13px",
                        color: colors.textSecondary,
                        borderBottom:
                          i < Math.min(notableNewBrandsPreview.length, 3) - 1
                            ? `1px solid ${colors.border}`
                            : "none",
                      }}
                    >
                      {row.company}
                    </td>
                    <td
                      style={{
                        padding: "8px",
                        borderBottom:
                          i < Math.min(notableNewBrandsPreview.length, 3) - 1
                            ? `1px solid ${colors.border}`
                            : "none",
                        textAlign: "center",
                      }}
                    >
                      <CategoryBadge category={row.category} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Text
              style={{
                fontSize: "12px",
                color: colors.textTertiary,
                margin: "0 0 24px 0",
                textAlign: "center",
              }}
            >
              + {parseInt(newBrands) - 3} more new brands last week
            </Text>

            {/* Locked Full List - Upgrade CTA */}
            <Section
              style={{
                backgroundColor: colors.purpleLight,
                borderRadius: "8px",
                border: `2px solid ${colors.purple}`,
                padding: "24px",
                textAlign: "center",
                marginBottom: "24px",
              }}
            >
              <Text
                style={{
                  fontSize: "18px",
                  margin: "0 0 8px 0",
                }}
              >
                🔒
              </Text>
              <Text
                style={{
                  fontSize: "16px",
                  fontWeight: "700",
                  color: colors.purple,
                  margin: "0 0 8px 0",
                }}
              >
                All {parseInt(newBrands) + parseInt(newSkus)} New Brands & SKUs
              </Text>
              <Text
                style={{
                  fontSize: "14px",
                  color: colors.textSecondary,
                  margin: "0 0 16px 0",
                  lineHeight: "1.5",
                }}
              >
                Get the complete list of every new product filed with the TTB last week, plus watchlist alerts, filing spike detection, and CSV exports.
              </Text>
              <Link
                href={pricingUrl}
                style={{
                  display: "inline-block",
                  backgroundColor: colors.purple,
                  color: "#ffffff",
                  fontSize: "14px",
                  fontWeight: "600",
                  padding: "12px 24px",
                  borderRadius: "8px",
                  textDecoration: "none",
                }}
              >
                See Upgrade Options
              </Link>
            </Section>

            {/* Browse database link */}
            <Section style={{ textAlign: "center" }}>
              <Link
                href={databaseUrl}
                style={{
                  color: colors.primary,
                  fontSize: "14px",
                  fontWeight: "500",
                  textDecoration: "none",
                }}
              >
                Browse all filings in database
              </Link>
            </Section>
          </Section>

          {/* Upgrade Options Card */}
          <Section
            style={{
              backgroundColor: colors.bg,
              borderRadius: "12px",
              border: `2px solid ${colors.primary}`,
              padding: "24px",
              marginTop: "16px",
            }}
          >
            <Text
              style={{
                fontSize: "16px",
                fontWeight: "700",
                color: colors.primary,
                margin: "0 0 16px 0",
                textAlign: "center",
              }}
            >
              Ready for More?
            </Text>

            {/* Pro */}
            <Section
              style={{
                backgroundColor: colors.primaryLight,
                borderRadius: "8px",
                padding: "16px",
                border: `1px solid ${colors.primary}`,
              }}
            >
              <Text style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: "700", color: colors.primaryDark }}>
                Pro — $99/mo
              </Text>
              <Text style={{ margin: 0, fontSize: "13px", color: colors.textSecondary, lineHeight: "1.5" }}>
                Full access to all categories. Real-time data, signal alerts, CSV exports, watchlists, and complete market intelligence across the entire industry.
              </Text>
            </Section>

            <Section style={{ textAlign: "center", marginTop: "16px" }}>
              <Link
                href={pricingUrl}
                style={{
                  display: "inline-block",
                  backgroundColor: colors.primary,
                  color: "#ffffff",
                  fontSize: "14px",
                  fontWeight: "600",
                  padding: "12px 24px",
                  borderRadius: "8px",
                  textDecoration: "none",
                }}
              >
                Compare Plans
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
              You're receiving this because you signed up at bevalcintel.com.
            </Text>
            <Text
              style={{
                fontSize: "12px",
                color: colors.textTertiary,
                margin: "0",
                lineHeight: "1.6",
              }}
            >
              <Link href="https://bevalcintel.com" style={{ color: colors.textTertiary }}>
                bevalcintel.com
              </Link>
              {" | "}
              <Link href="https://bevalcintel.com/account.html" style={{ color: colors.textTertiary }}>
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

export default WeeklyReport;
