/**
 * Netlify serverless function: form-submission
 *
 * Triggered by Netlify Forms when the "sample-request" form is submitted.
 * Netlify fires a POST to /.netlify/functions/form-submission with the
 * form payload as JSON in the request body.
 *
 * Sends two emails via Resend:
 *   1. A branded confirmation email to the lead with the sample pack links.
 *   2. A notification email to Stephen at stephen@sendnavigate.com.
 *
 * Required environment variables (set in Netlify dashboard):
 *   RESEND_API_KEY  — API key from resend.com (free tier: 3,000 emails/month)
 */

export default async (req) => {
  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  // Netlify Forms sends the submission data under payload.data
  const formData = payload.data || payload;

  const firstName  = formData["first-name"]  || "";
  const lastName   = formData["last-name"]   || "";
  const email      = formData["email"]       || "";
  const schoolName = formData["school-name"] || "";
  const role       = formData["role"]        || "";

  if (!email) {
    return new Response("No email address in submission", { status: 400 });
  }

  const fullName = `${firstName} ${lastName}`.trim() || "there";
  const resendApiKey = Netlify.env.get("RESEND_API_KEY");

  if (!resendApiKey) {
    console.error("RESEND_API_KEY environment variable is not set.");
    return new Response("Email service not configured", { status: 500 });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. CONFIRMATION EMAIL TO THE LEAD
  // ─────────────────────────────────────────────────────────────────────────
  const confirmationHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Free Sample Pack — SEND Navigate</title>
</head>
<body style="margin:0;padding:0;background:#F7F9FC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F9FC;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(30,58,95,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#1E3A5F;padding:32px 40px;">
              <p style="margin:0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:0.02em;">
                SEND<span style="color:#D4781A;">Navigate</span>
              </p>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.65);font-size:13px;">
                See It. Support It. Teach It.
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 16px;font-size:22px;font-weight:700;color:#1E3A5F;line-height:1.3;">
                Hi ${firstName || "there"}, your sample pack is attached.
              </p>
              <p style="margin:0 0 20px;color:#4B5563;font-size:15px;line-height:1.7;">
                Thank you for requesting a sample of the <strong>See It. Support It. Teach It.</strong> programme. Below you will find direct download links for each item in your sample pack.
              </p>

              <!-- Sample items -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#E3F4F1;border-left:4px solid #2D8A7A;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:10px;">
                    <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#2D8A7A;text-transform:uppercase;letter-spacing:0.08em;">Module 1 Slide Deck (Excerpt)</p>
                    <p style="margin:0 0 10px;font-size:14px;color:#374151;line-height:1.6;">The opening section of the <em>See It</em> module — the eight SEN profiles your staff need to recognise, and the masking framework that changes how teachers read behaviour.</p>
                    <a href="https://sendnavigate.org/wb.pdf" style="display:inline-block;background:#2D8A7A;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:8px 18px;border-radius:5px;">Download Sample Slides →</a>
                  </td>
                </tr>
                <tr><td style="height:10px;"></td></tr>
                <tr>
                  <td style="background:#E8EFF7;border-left:4px solid #1E3A5F;border-radius:0 8px 8px 0;padding:16px 20px;">
                    <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#1E3A5F;text-transform:uppercase;letter-spacing:0.08em;">Facilitator Guide Introduction</p>
                    <p style="margin:0 0 10px;font-size:14px;color:#374151;line-height:1.6;">The opening section of the guide your SENCo will use to run the INSET day — including the SLT briefing notes and the programme philosophy.</p>
                    <a href="https://sendnavigate.org/wb.pdf" style="display:inline-block;background:#1E3A5F;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:8px 18px;border-radius:5px;">Download Facilitator Guide Intro →</a>
                  </td>
                </tr>
                <tr><td style="height:10px;"></td></tr>
                <tr>
                  <td style="background:#FDF0E4;border-left:4px solid #D4781A;border-radius:0 8px 8px 0;padding:16px 20px;">
                    <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#D4781A;text-transform:uppercase;letter-spacing:0.08em;">EEF Five-a-Day Mapping Overview</p>
                    <p style="margin:0 0 10px;font-size:14px;color:#374151;line-height:1.6;">The research evidence trail — a section-by-section mapping against the EEF's adaptive teaching framework, ready for your Ofsted evidence pack.</p>
                    <a href="https://sendnavigate.org/wb.pdf" style="display:inline-block;background:#D4781A;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:8px 18px;border-radius:5px;">Download EEF Mapping →</a>
                  </td>
                </tr>
              </table>

              <!-- CPD badge note -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#1E3A5F;border-radius:8px;padding:18px 22px;">
                    <p style="margin:0;color:rgba(255,255,255,0.9);font-size:14px;line-height:1.65;">
                      🏅 <strong style="color:#ffffff;">CPD Certified — Member No. 22898.</strong> Every participant who completes the programme receives an official CPD certificate for their professional record. The programme is fully accredited by the CPD Certification Service.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <p style="margin:0 0 20px;color:#4B5563;font-size:15px;line-height:1.7;">
                If you have any questions about the programme, pricing, or how to run it in your school, I am happy to jump on a quick call. Just reply to this email.
              </p>
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#D4781A;border-radius:6px;padding:12px 24px;">
                    <a href="https://sendnavigate.org/for-schools#pricing" style="color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;">View Licence Pricing →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Signature -->
          <tr>
            <td style="padding:0 40px 40px;">
              <hr style="border:none;border-top:1px solid #E5EAF0;margin:0 0 24px;" />
              <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#1E3A5F;">Stephen Mallett</p>
              <p style="margin:0;font-size:13px;color:#6B7280;line-height:1.6;">
                Former Headteacher &amp; SENCo · 25 years in UK education<br/>
                Founder, SEND Navigate · CPD Member No. 22898<br/>
                <a href="mailto:stephen@sendnavigate.com" style="color:#2D8A7A;">stephen@sendnavigate.com</a> ·
                <a href="https://sendnavigate.org" style="color:#2D8A7A;">sendnavigate.org</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#F7F9FC;border-top:1px solid #E5EAF0;padding:20px 40px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.6;">
                You received this email because you requested a free sample from sendnavigate.org.<br/>
                SEND Navigate · <a href="https://sendnavigate.org/privacy-policy" style="color:#9CA3AF;">Privacy Policy</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  // ─────────────────────────────────────────────────────────────────────────
  // 2. NOTIFICATION EMAIL TO STEPHEN
  // ─────────────────────────────────────────────────────────────────────────
  const roleLabels = {
    headteacher: "Headteacher / Principal",
    sendco: "SENCo / SEND Lead",
    deputy: "Deputy / Assistant Headteacher",
    "mat-ceo": "MAT CEO / Director of Education",
    "cpd-provider": "CPD / INSET Provider",
    "class-teacher": "Class Teacher",
    other: "Other",
  };
  const roleLabel = roleLabels[role] || role || "Not specified";

  const notificationHtml = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>New Sample Request</title></head>
<body style="margin:0;padding:0;background:#F7F9FC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F9FC;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(30,58,95,0.08);">
          <tr>
            <td style="background:#2D8A7A;padding:24px 32px;">
              <p style="margin:0;color:#ffffff;font-size:18px;font-weight:800;">🎯 New Sample Request — SEND Navigate</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #E5EAF0;">
                    <p style="margin:0;font-size:13px;color:#6B7280;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Name</p>
                    <p style="margin:4px 0 0;font-size:15px;color:#1E3A5F;font-weight:600;">${fullName}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #E5EAF0;">
                    <p style="margin:0;font-size:13px;color:#6B7280;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Email</p>
                    <p style="margin:4px 0 0;font-size:15px;color:#1E3A5F;"><a href="mailto:${email}" style="color:#2D8A7A;">${email}</a></p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #E5EAF0;">
                    <p style="margin:0;font-size:13px;color:#6B7280;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">School / Organisation</p>
                    <p style="margin:4px 0 0;font-size:15px;color:#1E3A5F;font-weight:600;">${schoolName}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;">
                    <p style="margin:0;font-size:13px;color:#6B7280;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Role</p>
                    <p style="margin:4px 0 0;font-size:15px;color:#1E3A5F;font-weight:600;">${roleLabel}</p>
                  </td>
                </tr>
              </table>
              <table cellpadding="0" cellspacing="0" style="margin-top:24px;">
                <tr>
                  <td style="background:#D4781A;border-radius:6px;padding:10px 20px;">
                    <a href="mailto:${email}?subject=Re: Your SEND Navigate Sample Pack" style="color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">Reply to ${firstName} →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#F7F9FC;border-top:1px solid #E5EAF0;padding:16px 32px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9CA3AF;">Automated notification from sendnavigate.org · SEND Navigate</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  // ─────────────────────────────────────────────────────────────────────────
  // Send both emails via Resend
  // ─────────────────────────────────────────────────────────────────────────
  const sendEmail = async (to, subject, html, replyTo) => {
    const body = {
      from: "SEND Navigate <noreply@sendnavigate.org>",
      to: [to],
      subject,
      html,
    };
    if (replyTo) body.reply_to = replyTo;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Resend error (${res.status}): ${err}`);
    }
    return res.json();
  };

  try {
    // Send confirmation to lead
    await sendEmail(
      email,
      "Your free sample pack — See It. Support It. Teach It. | SEND Navigate",
      confirmationHtml,
      "stephen@sendnavigate.com"
    );

    // Send notification to Stephen
    await sendEmail(
      "stephen@sendnavigate.com",
      `New sample request: ${fullName} — ${schoolName}`,
      notificationHtml,
      email
    );

    console.log(`Sample request processed for ${email} (${schoolName})`);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Email send failed:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/.netlify/functions/form-submission",
};
