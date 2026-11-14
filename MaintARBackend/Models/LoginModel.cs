using System.ComponentModel.DataAnnotations;

namespace MaintARBackend.Models
{
    public class LoginModel
    {
        [Required(ErrorMessage = "Please enter your email")]
        [EmailAddress(ErrorMessage = "Invalid email format")]
        public required string Email { get; set; }

        [Required(ErrorMessage = "Please enter your password")]
        public required string Password { get; set; }
    }
}
