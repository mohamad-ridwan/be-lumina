const { HTTP_STATUS_CODE } = require("../constant");
const { generateBase64ThumbnailFromUrl } = require("../helpers/general");
const { generateRandomId } = require("../helpers/generateRandomId");
const users = require("../models/users");
const jwt = require("jsonwebtoken");

exports.updateProfile = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.params.id || req.body.id; // Ambil ID dari user login / body / param
    if (!userId) {
      return res
        .status(HTTP_STATUS_CODE.BAD_REQUEST)
        .json({ message: "User ID is required" });
    }

    const { image, username, imgCropped } = req.body;

    // Build update object dynamically
    const updateFields = {};
    if (image) {
      updateFields.image = image;

      const thumbnail = await generateBase64ThumbnailFromUrl(image);
      if (thumbnail) {
        updateFields.thumbnail = thumbnail;
      }
    }
    if (username) updateFields.username = username;
    if (imgCropped) updateFields.imgCropped = imgCropped;

    if (Object.keys(updateFields).length === 0) {
      return res
        .status(HTTP_STATUS_CODE.BAD_REQUEST)
        .json({ message: "No fields to update" });
    }

    const updatedUser = await users.findOneAndUpdate(
      { id: userId },
      { $set: updateFields },
      { new: true }
    );

    if (!updatedUser) {
      return res
        .status(HTTP_STATUS_CODE.NOT_FOUND)
        .json({ message: "User not found" });
    }

    return res
      .status(HTTP_STATUS_CODE.OK)
      .json({ message: "Profile updated", data: updatedUser });
  } catch (error) {
    console.error("Update profile error:", error);
    return res
      .status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal server error" });
  }
};

exports.searchUser = async (req, res, next) => {
  const { username, senderId } = req.body;

  if (!username || !username.trim()) {
    res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: "username or number required",
    });
    return;
  }

  const usersCurrently = await users.aggregate([
    {
      $match: {
        $and: [
          {
            $or: [
              {
                $expr: {
                  $regexMatch: {
                    input: { $toLower: "$username" },
                    regex: username.toLowerCase(),
                  },
                },
              },
              {
                $expr: {
                  $regexMatch: {
                    input: { $toString: "$phoneNumber" }, // Pastikan phoneNumber adalah string
                    regex: username,
                  },
                },
              },
            ],
          },
          {
            id: { $ne: senderId }, // Mengecualikan senderId
          },
        ],
        verification: true,
      },
    },
  ]);

  res.status(HTTP_STATUS_CODE.OK).json({
    message: "users data",
    data: usersCurrently,
  });
};

exports.getUser = async (req, res, next) => {
  const { id } = req.query;

  if (!id) {
    res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: "Query id required!",
    });
    return;
  }

  const userCurrently = await users.findOne({
    id,
    verification: true,
  });

  if (!userCurrently) {
    res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
      message: "User not found!",
    });
    return;
  }

  res.status(HTTP_STATUS_CODE.OK).json({
    message: "User Data",
    data: userCurrently,
  });
};

exports.profile = async (req, res, next) => {
  const { token } = req.body;

  if (!token) {
    res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: "token required!",
    });
    return;
  }

  jwt.verify(token, process.env.TOKEN_BEARER_SECRET, async (err, data) => {
    if (err) {
      res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: "Token is invalid or expired",
        errJwt: err,
      });
    } else {
      const userCurrently = await users.findOne({
        id: data.id,
        verification: true,
      });
      if (!userCurrently) {
        res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
          message: "User not registered",
        });
        return;
      }

      res.status(HTTP_STATUS_CODE.OK).json({
        message: "Profile Data",
        data: userCurrently,
      });
    }
  });
};

exports.login = async (req, res, next) => {
  const {
    username, // username || email
    password,
    phoneNumber,
  } = req.body;

  let err = {};
  if (!username || !username.trim()) {
    err.username = "Username or email required!";
  } else if (!password || !password.trim()) {
    err.password = "Password required!";
  } else if (!phoneNumber || !phoneNumber.trim()) {
    err.phoneNumber = "Phone Number required!";
  }

  if (Object.keys(err).length > 0) {
    res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: Object.entries(err).map((p) => p[1])[0],
    });
    return;
  }

  const userCurrently = await users.findOne({
    $or: [{ username: username }, { email: username }],
    password,
    phoneNumber,
    verification: true,
  });

  if (!userCurrently) {
    res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
      message: "Account not registered!",
    });
    return;
  }

  jwt.sign(
    {
      id: userCurrently.id,
    },
    process.env.TOKEN_BEARER_SECRET,
    { expiresIn: "24h" },
    (err, token) => {
      if (err) {
        next(err);
      } else {
        res.status(HTTP_STATUS_CODE.OK).json({
          message: "Successfully logged in",
          data: userCurrently,
          token: token,
        });
      }
    }
  );
};

exports.register = async (req, res, next) => {
  const { email, username, password, phoneNumber } = req.body;

  let err = {};
  if (!email || !email.trim()) {
    err.email = "Email required!";
  } else if (!username || !username.trim()) {
    err.username = "Username required!";
  } else if (!password || !password.trim()) {
    err.password = "Password required!";
  } else if (!phoneNumber || !phoneNumber.trim()) {
    err.phoneNumber = "Phone Number required!";
  }

  if (Object.keys(err).length > 0) {
    res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: Object.entries(err).map((p) => p[1])[0],
    });
    return;
  }

  const isUserAvailable = await users.findOne({ email });

  if (isUserAvailable && isUserAvailable?.verification) {
    res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: "Email or phone number is already registered!",
    });
    return;
  } else if (isUserAvailable && !isUserAvailable?.verification) {
    res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: "Your account needs to be verified",
    });
    return;
  }

  const post = new users({
    verification: false,
    username,
    email,
    password,
    image: null,
    id: generateRandomId(),
    phoneNumber,
  });
  post
    .save()
    .then((result) => {
      res.status(HTTP_STATUS_CODE.OK).json({
        message: "Successfully registered account",
        data: result,
      });
    })
    .catch((err) => {
      console.log("err-register", err);
      next(err);
    });
};
