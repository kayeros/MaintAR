using Resend;
using MaintARBackend.Models;

namespace MaintARBackend.Services.Email
{
    public class EmailService : IEmailService
    {
        private readonly IResend _resend;

        public EmailService(IResend resend)
        {
            _resend = resend;
        }

        public async Task SendEmailAsync(EmailDto dto)
        {
            var message = new EmailMessage();
            message.From = "onboarding@resend.dev";
            message.To.Add(dto.To);
            message.Subject = dto.Subject;
            message.TextBody = dto.Body;
            message.HtmlBody = dto.TemplateType switch
            {
                EmailTemplateType.ResetPassword => EmailTemplates.ResetPasswordCodeEmail(dto.Subject, dto.To, dto.Body),
                EmailTemplateType.EmailVerification => EmailTemplates.EmailVerificationCodeEmail(dto.Subject, dto.Body),
                _ => throw new ArgumentOutOfRangeException(nameof(dto.TemplateType))
            };

            await _resend.EmailSendAsync(message);
        }
    }
}
