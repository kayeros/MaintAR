using System.ComponentModel.DataAnnotations;

namespace MaintARBackend.Models
{
    public class ForgotPasswordModel
    {
        [Required(ErrorMessage = "Please enter your email")]
        [EmailAddress(ErrorMessage = "Invalid email format")]
        public required string Email { get; set; }
    }
}
