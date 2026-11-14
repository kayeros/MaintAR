using System.ComponentModel.DataAnnotations;

namespace MaintARBackend.Models
{
    public class RegisterModel
    {
        [Required(ErrorMessage = "Please enter your email")]
        [EmailAddress(ErrorMessage = "Invalid email format")]
        public required string Email { get; set; }

        [Required(ErrorMessage = "Please enter your Name")]
        [StringLength(50)]
        [MinLength(2)]
        public required string UserName { get; set; }

        [Required(ErrorMessage = "Please enter your password")]
        [MinLength(6, ErrorMessage = "Password must be at least 6 characters long")]
        public required string Password { get; set; }
    }
}
