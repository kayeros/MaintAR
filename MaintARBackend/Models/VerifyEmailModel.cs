using System.ComponentModel.DataAnnotations;

namespace MaintARBackend.Models
{
    public class VerifyEmailModel
    {
        [Required(ErrorMessage = "Please enter the code")]
        public required string Code { get; set; }
    }
}
