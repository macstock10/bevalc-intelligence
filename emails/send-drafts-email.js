// Temporary script to send content drafts email
import { Resend } from 'resend';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

const resend = new Resend(process.env.RESEND_API_KEY);

const emailContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #1e293b; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #0d9488; border-bottom: 2px solid #0d9488; padding-bottom: 10px; }
    h2 { color: #334155; margin-top: 30px; }
    h3 { color: #475569; }
    .section { background: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .stat { display: inline-block; background: #0d9488; color: white; padding: 8px 16px; border-radius: 4px; margin: 5px; }
    .linkedin-post { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin: 15px 0; white-space: pre-wrap; }
    .absurd { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 15px 0; }
    pre { background: #1e293b; color: #e2e8f0; padding: 15px; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>Weekly Content Drafts - Week Ending January 11, 2026</h1>

  <div class="section">
    <h2>Summary Stats</h2>
    <div class="stat">21,633 Total Filings</div>
    <div class="stat">5,615 New Brands</div>
    <div class="stat">787 New Companies</div>
    <div class="stat">Wine: 63%</div>
  </div>

  <h2>Newsletter Email</h2>
  <div class="section">
    <p><strong>Subject:</strong> 21,633 Labels Filed. A Lawyer Whiskey. Some Dragons.</p>
    <p><strong>Preview:</strong> TTB filings for the week ending January 11, 2026. Wine dominated. Breweries are making whiskey and wine now.</p>
    <p><strong>Lead:</strong> The TTB approved 21,633 label applications this week. 5,615 were new brands. 787 were from companies filing for the first time. Someone filed a whiskey called 'Association of Corporate Counsel.' I will get to that.</p>

    <h3>Main Story: The Corporate Counsel Whiskey</h3>
    <p>AlphaBeta Brewery filed a whiskey called 'Association of Corporate Counsel' on January 8th. The TTB approved it.</p>
    <p>A brewery. Making whiskey. Named after what appears to be a legal trade organization.</p>
    <p>I do not know if actual lawyers are involved. I am not going to investigate further. The filing exists. That is enough.</p>

    <h3>Quick Hits</h3>
    <ul>
      <li>Tree House Brewing filed 178 labels. They do this a lot.</li>
      <li>Burial Beer Co. filed a red wine called 'Conjured in Shadows.' A brewery. Making wine.</li>
      <li>Vicious Fishes Brewery filed two dragon IPAs in one week. The company makes fish-themed beer about dragons.</li>
      <li>Four Loko filed 'STORM.' They are still innovating. The brand persists.</li>
    </ul>
  </div>

  <h2>LinkedIn Posts (Ready to Copy)</h2>

  <div class="linkedin-post">21,633 alcohol labels were filed with the TTB last week. 5,615 were new brands. 787 were from companies filing for the first time ever.

Someone at a company called AlphaBeta Brewery filed a whiskey called "Association of Corporate Counsel." It was approved on January 8th. I do not know why a brewery is making whiskey. I do not know why they named it after what appears to be a legal trade organization.

These are the things that happen in the TTB database. We track them.</div>

  <div class="linkedin-post">Tree House Brewing Company filed 178 labels in one week. That is more than one per hour if you assume eight-hour days.

They make hazy IPAs. People drive to Massachusetts to buy them. The company does not distribute widely. You have to go there or know someone who went there.

Somehow this business model supports filing 178 labels in seven days. I do not fully understand craft beer economics.</div>

  <div class="linkedin-post">A brewery in Asheville called Burial Beer Co. filed a red wine this week. The wine is called "VISUALS" with a fanciful name of "CONJURED IN SHADOWS."

I do not know when breweries started making wine. The TTB approved it. It is in the database now. A beer company making wine. The categories blur.</div>

  <div class="linkedin-post">Four Loko filed a new variant called "STORM" this week. This is at least the fourteenth new Four Loko filing in the past six months.

The brand persists. They are still innovating. Someone is still drinking Four Loko. Multiple someones, presumably, given the ongoing filing activity.

I track these things. I do not judge them.</div>

  <h2>Absurd Stories</h2>

  <div class="absurd">
    <h3>The Corporate Counsel Whiskey Situation</h3>
    <p>AlphaBeta Brewery filed a whiskey called 'Association of Corporate Counsel' on January 8th, 2026. The TTB approved it.</p>
    <p>There are several things to unpack here. First, AlphaBeta Brewery is a brewery. Breweries make beer. This is whiskey. Second, 'Association of Corporate Counsel' is the name of an actual organization. It has over 45,000 members. They are lawyers.</p>
    <p>I do not know if the actual Association of Corporate Counsel is aware of this whiskey. I do not know if they licensed their name. I do not know if this is a collaboration or a coincidence or something else entirely.</p>
    <p>The filing lists the location as somewhere I cannot fully make out. The class type is WHISKY, spelled the Scottish way, without the E. This suggests something about the production method or the origin or nothing at all.</p>
    <p>A whiskey named after lawyers, made by a brewery, approved by the federal government. This is the beverage industry in 2026.</p>
  </div>

  <div class="absurd">
    <h3>The Dragon Situation at Vicious Fishes</h3>
    <p>Vicious Fishes Brewery filed two dragon-themed IPAs in the same week. 'DOUBLE DRAGONS INDIA PALE ALE' and 'HERE BE DRAGONS INDIA PALE ALE.'</p>
    <p>The company is called Vicious Fishes. They make beers about dragons. I do not know how to reconcile this. Fish are not dragons. Dragons are not fish. Perhaps there is a mythology I am unaware of.</p>
    <p>Maroni Beverage Company handles their paperwork. Someone at Maroni had to type 'DOUBLE DRAGONS INDIA PALE ALE' into the TTB system. They did this. The TTB looked at it. They approved it.</p>
    <p>The beers are presumably different. You do not file two labels for the same beer. There is a Double Dragons and there is a Here Be Dragons and these are distinct products with distinct recipes that both involve dragons.</p>
    <p>I have not tasted either one. I do not know if they taste like dragons. I do not know what dragons taste like. This is speculation.</p>
  </div>

  <div class="absurd">
    <h3>Mandatory Fun Demands You Be Wild and Crazy</h3>
    <p>There is a brewery called Mandatory Fun Beer Works. This is the actual name of a business that exists and files federal paperwork.</p>
    <p>This week they filed a beer called 'WILD AND CRAZY.'</p>
    <p>The juxtaposition is interesting. Fun is mandatory. It is required. You will have it. But also, be wild. Be crazy. Within the mandatory fun parameters, presumably.</p>
    <p>The company is listed under Arcanum Ventures, LLC. Arcanum means 'secret' or 'mystery.' So we have a secret venture company running a mandatory fun brewery that makes wild and crazy beer.</p>
    <p>I do not know what is happening in the craft beer industry. I just read the filings.</p>
  </div>

  <h2>Blog Post (Weekly Roundup)</h2>
  <div class="section">
    <p><strong>Title:</strong> 21,633 Labels Were Filed This Week. Here Are Some of Them.</p>
    <p><strong>Word Count:</strong> 742 words</p>
    <p><strong>URL Slug:</strong> weekly-roundup-2026-01-11</p>
    <p>Full markdown content is in the articles-2026-01-11.json file.</p>
  </div>

  <h2>Company Spotlight</h2>
  <div class="section">
    <p><strong>Company:</strong> Tree House Brewing Company</p>
    <p><strong>Title:</strong> Tree House Filed 178 Labels This Week. They Do This A Lot.</p>
    <p><strong>Word Count:</strong> 312 words</p>
    <p>Full content is in the articles-2026-01-11.json file.</p>
  </div>

  <hr>
  <p style="color: #64748b; font-size: 14px;">Generated by /weekly-content pipeline. All content files saved to scripts/content-queue/</p>
</body>
</html>
`;

async function main() {
  try {
    const { data, error } = await resend.emails.send({
      from: 'BevAlc Intelligence <hello@bevalcintel.com>',
      to: 'mac.rowan@outlook.com',
      subject: 'Weekly Content Drafts - Week Ending January 11, 2026',
      html: emailContent,
    });

    if (error) {
      console.error('Error sending email:', error);
      process.exit(1);
    }

    console.log('Email sent successfully!');
    console.log('Email ID:', data.id);
  } catch (err) {
    console.error('Failed to send email:', err);
    process.exit(1);
  }
}

main();
