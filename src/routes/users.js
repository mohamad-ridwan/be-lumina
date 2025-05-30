const router = require("express").Router();

const {
  register,
  login,
  profile,
  getUser,
  searchUser,
  updateProfile,
} = require("../controllers/users");

router.post("/register", register);
router.post("/login", login);
router.post("/profile", profile);
router.post("/get-user", getUser);
router.post("/search-users", searchUser);
router.post("/update-profile", updateProfile);

module.exports = router;
