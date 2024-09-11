import nodemailer from 'nodemailer';

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  ENABLE_EMAILS,
} = process.env;

// Create a transporter object using the SMTP transport
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

interface Mail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

// Send an email
const sendMail = async (mail: Mail) => {
  if (ENABLE_EMAILS !== 'true') {
    console.log(`Email sending disabled. Would have sent email:
      From: ${mail.from}
      To: ${mail.to}
      Subject: ${mail.subject}`);
    return;
  }

  try {
    const info = await transporter.sendMail(mail);
    console.log('Message sent: %s', info.messageId);
  } catch (error) {
    console.error('Error sending email:', error);
  }
};

export { sendMail };
