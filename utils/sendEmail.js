import nodemailer from 'nodemailer';


const sendEmail = async (options) => {
    // 1) Create transporter
    const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        secure: true,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD,

        },
    })

    // 2) Define email options using template literals if needed
    const mailOpts = {
        from: `Tayyran App <${process.env.EMAIL_USER}>`,
        to: options.email,
        subject: options.subject,
        // Using template literals for message formatting
        html: options.message,
        // Optional HTML version using template literals
        // html: `<p>${options.message}</p>`,
    };

    // 3) Send email
    try {
        await transporter.sendMail(mailOpts);
        console.log(`Email sent to ${options.email}`);
    } catch (error) {
        console.error('Error sending email:', error);
        throw error; // Re-throw to handle in calling function
    }
};

export default sendEmail;
