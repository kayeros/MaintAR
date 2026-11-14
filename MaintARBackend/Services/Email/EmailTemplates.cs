using System;

namespace MaintARBackend.Services.Email
{
    public static class EmailTemplates
    {
        public static string ResetPasswordCodeEmail(string subject, string email, string code)
        {
            var link = $"https://example.com/reset-password?email={Uri.EscapeDataString(email)}&code={Uri.EscapeDataString(code)}";

            return $@"
<div style=""font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background-color: #f4f4f7;"">
    <div style=""background: #ffffff; border-radius: 8px; padding: 32px; text-align: center;"">
        <h2 style=""color: #1a1a1a; margin: 0 0 8px;"">MaintAR</h2>
        <p style=""color: #555555; font-size: 15px; margin: 0 0 24px;"">{subject}</p>
        <a href=""{link}"" style=""display: inline-block; padding: 12px 28px; background-color: #4f46e5; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold;"">
            Перейти к вводу нового пароля
        </a>
        <p style=""color: #999999; font-size: 12px; margin: 24px 0 0;"">Если это были не вы — просто проигнорируйте это письмо.</p>
    </div>
</div>";
        }

        public static string EmailVerificationCodeEmail(string subject, string code)
        {
            return $@"
<div style=""font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background-color: #f4f4f7;"">
    <div style=""background: #ffffff; border-radius: 8px; padding: 32px; text-align: center;"">
        <h2 style=""color: #1a1a1a; margin: 0 0 8px;"">MaintAR</h2>
        <p style=""color: #555555; font-size: 15px; margin: 0 0 24px;"">{subject}</p>
        <div style=""margin: 0 0 24px; padding: 16px; border: 1px dashed #cccccc; border-radius: 6px; font-size: 28px; letter-spacing: 6px; font-weight: bold; color: #2d2d2d; background: #fafafa;"">
            {code}
        </div>
        <p style=""color: #999999; font-size: 12px; margin: 24px 0 0;"">Если это были не вы — просто проигнорируйте это письмо.</p>
    </div>
</div>";
        }

        public static string LoginCodeEmail(string subject, string code)
        {
            return $@"
<div style=""font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background-color: #f4f4f7;"">
    <div style=""background: #ffffff; border-radius: 8px; padding: 32px; text-align: center;"">
        <h2 style=""color: #1a1a1a; margin: 0 0 8px;"">MaintAR</h2>
        <p style=""color: #555555; font-size: 15px; margin: 0 0 24px;"">{subject}</p>
        <div style=""margin: 0 0 24px; padding: 16px; border: 1px dashed #cccccc; border-radius: 6px; font-size: 28px; letter-spacing: 6px; font-weight: bold; color: #2d2d2d; background: #fafafa;"">
            {code}
        </div>
        <a href=""https://example.com/login"" style=""display: inline-block; padding: 12px 28px; background-color: #4f46e5; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold;"">
            Войти
        </a>
        <p style=""color: #999999; font-size: 12px; margin: 24px 0 0;"">Если это были не вы — просто проигнорируйте это письмо.</p>
    </div>
</div>";
        }
    }
}
