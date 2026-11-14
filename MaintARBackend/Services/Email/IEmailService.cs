using MaintARBackend.Models;

namespace MaintARBackend.Services.Email
{

    public interface IEmailService
    {
        Task SendEmailAsync(EmailDto dto);
    }
}
