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

// Brand colors
const colors = {
  primary: "#0d9488",
  primaryDark: "#0f766e",
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

// Stat Tile Component
function StatTile({ label, value, subtext, trend }) {
  return (
    <td style={{
      backgroundColor: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: "8px",
      padding: "16px",
      textAlign: "center",
      width: "33%",
    }}>
      <Text style={{
        fontSize: "28px",
        fontWeight: "700",
        color: colors.primary,
        margin: "0",
        lineHeight: "1.2",
      }}>
        {value}
      </Text>
      <Text style={{
        fontSize: "12px",
        color: colors.textSecondary,
        margin: "4px 0 0 0",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
      }}>
        {label}
      </Text>
      {subtext && (
        <Text style={{
          fontSize: "11px",
          color: trend === "up" ? colors.green : trend === "down" ? colors.red : colors.textTertiary,
          margin: "4px 0 0 0",
        }}>
          {subtext}
        </Text>
      )}
    </td>
  );
}

// CSS Bar Chart Row - Using tables for email client compatibility
function BarRow({ label, value, maxValue, color = colors.primary }) {
  const percentage = Math.min(Math.round((value / maxValue) * 100), 100);
  const barWidth = Math.max(percentage, 5); // Minimum 5% so bar is visible

  return (
    <tr>
      <td style={{
        padding: "8px 0",
        fontSize: "13px",
        fontWeight: "500",
        color: colors.text,
        width: "90px",
      }}>
        {label}
      </td>
      <td style={{
        padding: "8px 0",
        fontSize: "13px",
        fontWeight: "600",
        color: colors.textSecondary,
        width: "50px",
        textAlign: "right",
      }}>
        {value}
      </td>
      <td style={{ padding: "8px 0 8px 12px" }}>
        {/* Bar using nested table for email client compatibility */}
        <table cellPadding="0" cellSpacing="0" width="140" style={{
          backgroundColor: colors.bgTertiary,
          borderRadius: "4px",
        }}>
          <tbody>
            <tr>
              <td style={{
                backgroundColor: color,
                height: "14px",
                width: `${barWidth}%`,
                borderRadius: "4px",
              }}></td>
              <td style={{ height: "14px" }}></td>
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
    <span style={{
      display: "inline-block",
      backgroundColor: colorScheme.bg,
      color: colorScheme.text,
      fontSize: "11px",
      fontWeight: "600",
      padding: "3px 8px",
      borderRadius: "4px",
    }}>
      {category}
    </span>
  );
}

// Signal Badge Component
function SignalBadge({ signal }) {
  const config = signalColors[signal] || signalColors.REFILE;
  return (
    <span style={{
      display: "inline-block",
      backgroundColor: config.bg,
      color: config.text,
      fontSize: "10px",
      fontWeight: "600",
      padding: "2px 6px",
      borderRadius: "3px",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
    }}>
      {config.label}
    </span>
  );
}

export function WeeklyReport({
  weekEnding = "January 5, 2026",
  summary = "Tequila filings up 23% as brands prep for spring launches",

  // Stat tiles
  totalFilings = "847",
  newBrands = "23",
  newSkus = "156",
  newCompanies = "8",
  topFiler = "Diageo",
  topFilerCount = "34",

  // Category bar chart data (total filings by category this week)
  categoryData = [
    { label: "Whiskey", value: 187 },
    { label: "Tequila", value: 156 },
    { label: "Vodka", value: 134 },
    { label: "Wine", value: 98 },
    { label: "Beer", value: 76 },
    { label: "RTD", value: 64 },
  ],

  // Top filing companies this week (ranked by total filings)
  topCompaniesList = [
    { company: "Diageo", category: "Whiskey", filings: 34 },
    { company: "Constellation Brands", category: "Beer", filings: 28 },
    { company: "Pernod Ricard", category: "Whiskey", filings: 22 },
    { company: "E&J Gallo", category: "Wine", filings: 19 },
    { company: "Brown-Forman", category: "Whiskey", filings: 16 },
  ],

  // Top brand extensions this week (brands with most NEW_SKU filings)
  topExtensionsList = [
    { brand: "Crown Royal", company: "Diageo", category: "Whiskey", newSkus: 14 },
    { brand: "High Noon", company: "E&J Gallo", category: "RTD", newSkus: 9 },
    { brand: "Modelo Especial", company: "Constellation", category: "Beer", newSkus: 8 },
    { brand: "Tito's Handmade", company: "Fifth Generation", category: "Vodka", newSkus: 6 },
    { brand: "Hendrick's", company: "William Grant", category: "Gin", newSkus: 5 },
  ],

  // Pro preview - sample label with TTB link
  proPreviewLabel = {
    brand: "Clase Azul Reposado",
    company: "Clase Azul",
    signal: "NEW_BRAND",
    ttbId: "24087001000453",
    ttbLink: "https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=24087001000453",
  },

  // Links
  databaseUrl = "https://bevalcintel.com/database",
  pricingUrl = "https://bevalcintel.com/#pricing",
}) {
  const maxCategoryValue = Math.max(...categoryData.map(d => d.value));

  return (
    <Html>
      <Head />
      <Preview>BevAlc Weekly: {totalFilings} filings, {newBrands} new brands - {summary}</Preview>
      <Body style={{
        backgroundColor: colors.bgSecondary,
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        margin: 0,
        padding: 0,
      }}>
        <Container style={{
          margin: "0 auto",
          padding: "32px 16px",
          maxWidth: "560px",
        }}>
          {/* Header */}
          <Section style={{ textAlign: "center", marginBottom: "24px" }}>
            <Link href="https://bevalcintel.com" style={{
              color: colors.primary,
              fontSize: "20px",
              fontWeight: "600",
              textDecoration: "none",
            }}>
              BevAlc Intelligence
            </Link>
            <Text style={{
              fontSize: "13px",
              color: colors.textTertiary,
              margin: "4px 0 0 0",
            }}>
              Weekly Market Snapshot
            </Text>
          </Section>

          {/* Main Card */}
          <Section style={{
            backgroundColor: colors.bg,
            borderRadius: "12px",
            border: `1px solid ${colors.border}`,
            padding: "24px",
          }}>
            {/* Week & Summary */}
            <Text style={{
              fontSize: "12px",
              color: colors.textTertiary,
              textTransform: "uppercase",
              letterSpacing: "1px",
              margin: "0 0 4px 0",
            }}>
              Week Ending {weekEnding}
            </Text>
            <Heading style={{
              fontSize: "18px",
              fontWeight: "600",
              color: colors.text,
              margin: "0 0 20px 0",
              lineHeight: "1.4",
            }}>
              {summary}
            </Heading>

            {/* Stat Tiles - Row 1 */}
            <table width="100%" cellPadding="0" cellSpacing="8" style={{ marginBottom: "8px" }}>
              <tbody>
                <tr>
                  <StatTile label="Total Filings" value={totalFilings} />
                  <StatTile label="New Brands" value={newBrands} />
                  <StatTile label="New SKUs" value={newSkus} />
                </tr>
              </tbody>
            </table>

            {/* Stat Tiles - Row 2 */}
            <table width="100%" cellPadding="0" cellSpacing="8" style={{ marginBottom: "24px" }}>
              <tbody>
                <tr>
                  <StatTile label="New Companies" value={newCompanies} />
                  <StatTile
                    label="Top Filer"
                    value={topFiler}
                    subtext={`${topFilerCount} filings`}
                  />
                  <td style={{ width: "33%" }}></td>
                </tr>
              </tbody>
            </table>

            {/* Category Activity Bar Chart */}
            <Text style={{
              fontSize: "13px",
              fontWeight: "600",
              color: colors.text,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              margin: "0 0 4px 0",
            }}>
              Filings by Category
            </Text>
            <Text style={{
              fontSize: "11px",
              color: colors.textTertiary,
              margin: "0 0 12px 0",
            }}>
              Total approvals this week
            </Text>
            <table width="100%" cellPadding="0" cellSpacing="0" style={{ marginBottom: "24px" }}>
              <tbody>
                {categoryData.map((item, i) => (
                  <BarRow
                    key={i}
                    label={item.label}
                    value={item.value}
                    maxValue={maxCategoryValue}
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
                See more on database
              </Button>
            </Section>

            <Hr style={{ borderTop: `1px solid ${colors.border}`, margin: "24px 0" }} />

            {/* Top Filing Companies */}
            <Text style={{
              fontSize: "13px",
              fontWeight: "600",
              color: colors.text,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              margin: "0 0 4px 0",
            }}>
              Top Filing Companies
            </Text>
            <Text style={{
              fontSize: "11px",
              color: colors.textTertiary,
              margin: "0 0 12px 0",
            }}>
              Companies with the most filings this week
            </Text>
            <table width="100%" cellPadding="0" cellSpacing="0" style={{
              borderRadius: "8px",
              border: `1px solid ${colors.border}`,
              borderCollapse: "separate",
              overflow: "hidden",
              marginBottom: "24px",
            }}>
              <tbody>
                {/* Header Row */}
                <tr style={{ backgroundColor: colors.greenLight }}>
                  <td style={{
                    padding: "8px 12px",
                    fontSize: "11px",
                    fontWeight: "600",
                    color: colors.green,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    borderBottom: `1px solid ${colors.border}`,
                  }}>Company</td>
                  <td style={{
                    padding: "8px 12px",
                    fontSize: "11px",
                    fontWeight: "600",
                    color: colors.green,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    borderBottom: `1px solid ${colors.border}`,
                    width: "90px",
                  }}>Top Category</td>
                  <td style={{
                    padding: "8px 12px",
                    fontSize: "11px",
                    fontWeight: "600",
                    color: colors.green,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    borderBottom: `1px solid ${colors.border}`,
                    width: "60px",
                    textAlign: "center",
                  }}>Filings</td>
                </tr>
                {/* Data Rows */}
                {topCompaniesList.map((row, i) => (
                  <tr key={i} style={{ backgroundColor: i % 2 === 0 ? colors.bg : colors.bgSecondary }}>
                    <td style={{
                      padding: "10px 12px",
                      fontSize: "13px",
                      fontWeight: "500",
                      color: colors.text,
                      borderBottom: i < topCompaniesList.length - 1 ? `1px solid ${colors.border}` : "none",
                    }}>{row.company}</td>
                    <td style={{
                      padding: "10px 12px",
                      borderBottom: i < topCompaniesList.length - 1 ? `1px solid ${colors.border}` : "none",
                    }}>
                      <CategoryBadge category={row.category} />
                    </td>
                    <td style={{
                      padding: "10px 12px",
                      fontSize: "13px",
                      fontWeight: "600",
                      color: colors.text,
                      borderBottom: i < topCompaniesList.length - 1 ? `1px solid ${colors.border}` : "none",
                      textAlign: "center",
                    }}>{row.filings}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Top Brand Extensions */}
            <Text style={{
              fontSize: "13px",
              fontWeight: "600",
              color: colors.text,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              margin: "0 0 4px 0",
            }}>
              Top Brand Extensions
            </Text>
            <Text style={{
              fontSize: "11px",
              color: colors.textTertiary,
              margin: "0 0 12px 0",
            }}>
              Brands adding the most new SKUs this week
            </Text>
            <table width="100%" cellPadding="0" cellSpacing="0" style={{
              borderRadius: "8px",
              border: `1px solid ${colors.border}`,
              borderCollapse: "separate",
              overflow: "hidden",
              marginBottom: "24px",
            }}>
              <tbody>
                {/* Header Row */}
                <tr style={{ backgroundColor: colors.blueLight }}>
                  <td style={{
                    padding: "8px 12px",
                    fontSize: "11px",
                    fontWeight: "600",
                    color: colors.blue,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    borderBottom: `1px solid ${colors.border}`,
                  }}>Brand</td>
                  <td style={{
                    padding: "8px 12px",
                    fontSize: "11px",
                    fontWeight: "600",
                    color: colors.blue,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    borderBottom: `1px solid ${colors.border}`,
                  }}>Company</td>
                  <td style={{
                    padding: "8px 12px",
                    fontSize: "11px",
                    fontWeight: "600",
                    color: colors.blue,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    borderBottom: `1px solid ${colors.border}`,
                    width: "90px",
                  }}>Category</td>
                  <td style={{
                    padding: "8px 12px",
                    fontSize: "11px",
                    fontWeight: "600",
                    color: colors.blue,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    borderBottom: `1px solid ${colors.border}`,
                    width: "70px",
                    textAlign: "center",
                  }}>New SKUs</td>
                </tr>
                {/* Data Rows */}
                {topExtensionsList.map((row, i) => (
                  <tr key={i} style={{ backgroundColor: i % 2 === 0 ? colors.bg : colors.bgSecondary }}>
                    <td style={{
                      padding: "10px 12px",
                      fontSize: "13px",
                      fontWeight: "500",
                      color: colors.text,
                      borderBottom: i < topExtensionsList.length - 1 ? `1px solid ${colors.border}` : "none",
                    }}>{row.brand}</td>
                    <td style={{
                      padding: "10px 12px",
                      fontSize: "13px",
                      color: colors.textSecondary,
                      borderBottom: i < topExtensionsList.length - 1 ? `1px solid ${colors.border}` : "none",
                    }}>{row.company}</td>
                    <td style={{
                      padding: "10px 12px",
                      borderBottom: i < topExtensionsList.length - 1 ? `1px solid ${colors.border}` : "none",
                    }}>
                      <CategoryBadge category={row.category} />
                    </td>
                    <td style={{
                      padding: "10px 12px",
                      fontSize: "13px",
                      fontWeight: "600",
                      color: colors.text,
                      borderBottom: i < topExtensionsList.length - 1 ? `1px solid ${colors.border}` : "none",
                      textAlign: "center",
                    }}>{row.newSkus}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Secondary CTA */}
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

          {/* Pro Feature Preview */}
          <Section style={{
            backgroundColor: colors.bg,
            borderRadius: "12px",
            border: `2px solid ${colors.purple}`,
            padding: "20px",
            marginTop: "16px",
          }}>
            <table width="100%" cellPadding="0" cellSpacing="0">
              <tbody>
                <tr>
                  <td>
                    <Text style={{
                      fontSize: "11px",
                      fontWeight: "600",
                      color: colors.purple,
                      textTransform: "uppercase",
                      letterSpacing: "1px",
                      margin: "0 0 12px 0",
                    }}>
                      Pro Feature: Direct TTB Label Access
                    </Text>
                    <table cellPadding="0" cellSpacing="0" style={{ marginBottom: "12px" }}>
                      <tbody>
                        <tr>
                          <td style={{ paddingRight: "8px" }}>
                            <SignalBadge signal={proPreviewLabel.signal} />
                          </td>
                          <td>
                            <Text style={{
                              fontSize: "14px",
                              fontWeight: "600",
                              color: colors.text,
                              margin: "0",
                            }}>
                              {proPreviewLabel.brand}
                            </Text>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <Text style={{
                      fontSize: "13px",
                      color: colors.textSecondary,
                      margin: "0 0 12px 0",
                    }}>
                      {proPreviewLabel.company}
                    </Text>
                    <Link
                      href={proPreviewLabel.ttbLink}
                      style={{
                        display: "inline-block",
                        backgroundColor: colors.purple,
                        color: "#ffffff",
                        fontSize: "12px",
                        fontWeight: "500",
                        padding: "8px 14px",
                        borderRadius: "6px",
                        textDecoration: "none",
                      }}
                    >
                      View Label on TTB.gov
                    </Link>
                  </td>
                </tr>
              </tbody>
            </table>
            <Hr style={{ borderTop: `1px solid ${colors.border}`, margin: "16px 0 12px 0" }} />
            <Text style={{
              fontSize: "12px",
              color: colors.textSecondary,
              margin: "0",
            }}>
              <strong style={{ color: colors.purple }}>Pro members</strong> get one-click access to official TTB labels for every filing, plus category-specific reports, watchlist alerts, and unlimited CSV exports.{" "}
              <Link href={pricingUrl} style={{ color: colors.purple, textDecoration: "underline" }}>
                See all Pro features
              </Link>
            </Text>
          </Section>

          {/* Footer */}
          <Section style={{ textAlign: "center", marginTop: "24px" }}>
            <Text style={{
              fontSize: "12px",
              color: colors.textTertiary,
              margin: "0",
              lineHeight: "1.6",
            }}>
              <Link href="https://bevalcintel.com" style={{ color: colors.textTertiary }}>
                bevalcintel.com
              </Link>
              {" | "}
              <Link href="https://bevalcintel.com/preferences" style={{ color: colors.textTertiary }}>
                Manage preferences
              </Link>
              {" | "}
              <Link href="{{unsubscribeUrl}}" style={{ color: colors.textTertiary }}>
                Unsubscribe
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default WeeklyReport;
