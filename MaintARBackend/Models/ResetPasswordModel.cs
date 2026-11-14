using System.ComponentModel.DataAnnotations;

namespace MaintARBackend.Models
{
    public class ResetPasswordModel
    {
        [Required(ErrorMessage = "Please enter your email")]
        [EmailAddress(ErrorMessage = "Invalid email format")]
        public required string Email { get; set; }

        [Required(ErrorMessage = "Please enter the code")]
        public required string Code { get; set; }

        [Required(ErrorMessage = "Please enter a new password")]
        [MinLength(6, ErrorMessage = "Password must be at least 6 characters long")]
        public required string NewPassword { get; set; }
    }
}
